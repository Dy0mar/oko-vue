import { computed, reactive, ref, shallowRef } from "vue"

import { supabase } from "src/api/supabase"
import { fetchIceServers, type IceServerEntry } from "src/api/iceServers"
import { expandIceServers, testIceUrl, type IceUrlTest } from "src/diagnostics/ice"
import {
  analyzeNat,
  probeHttp,
  probeIce,
  publicAddresses,
  type NatVerdict,
} from "src/diagnostics/probes"
import { probeRealtime } from "src/diagnostics/realtime"
import { HTTP_TARGETS } from "src/diagnostics/targets"

export type CheckStatus = "idle" | "running" | "ok" | "fail"

export interface CheckRow {
  label: string
  target: string
  status: CheckStatus
  ms?: number | null
  detail?: string
  kind?: IceUrlTest["kind"]
}

export interface NatInfo {
  verdict: NatVerdict
  publicIps: string[]
  servers: number
}

/**
 * ok   — can call: TURN works, or STUN works and the NAT is friendly
 * warn — may work: STUN works but NAT is symmetric/unknown and there is no TURN
 * fail — cannot call: no signaling, no server config, or no STUN and no TURN at all
 */
export type CheckVerdict = "ok" | "warn" | "fail"

export const NAT_TEXT: Record<NatVerdict, string> = {
  "not-symmetric": "НЕ симетричний: пряме з'єднання ймовірно можливе",
  symmetric: "СИМЕТРИЧНИЙ: пряме з'єднання навряд чи спрацює, потрібен TURN",
  unknown: "невідомо (потрібно ≥2 робочих STUN)",
}

function collectEnv() {
  const connection = (navigator as Navigator & { connection?: Record<string, unknown> }).connection
  return {
    time: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    webrtc: "RTCPeerConnection" in window,
    network: connection
      ? { type: connection.effectiveType, downlinkMbps: connection.downlink, rttMs: connection.rtt }
      : "n/a",
  }
}

/** Network check shared by /diag (detailed view) and /meet (progress ring only). */
export function useNetworkCheck() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

  const services = reactive<CheckRow[]>([
    ...HTTP_TARGETS.map((t) => ({ label: t.label, target: t.url, status: "idle" as CheckStatus })),
    { label: "Supabase (REST)", target: `${supabaseUrl}/auth/v1/health`, status: "idle" },
    { label: "Supabase Realtime (канал)", target: `${supabaseUrl}/realtime/v1`, status: "idle" },
    { label: "Конфігурація серверів", target: "edge function ice-servers", status: "idle" },
  ])
  const internetRows = services.slice(0, HTTP_TARGETS.length)
  const restRow = services[HTTP_TARGETS.length]!
  const realtimeRow = services[HTTP_TARGETS.length + 1]!
  const configRow = services[HTTP_TARGETS.length + 2]!

  const ice = ref<CheckRow[]>([])
  /** Credentials stay out of reactive rows and out of the report. */
  const testByRow = new WeakMap<object, IceUrlTest>()
  const entries = shallowRef<IceServerEntry[]>([])
  const nat = ref<NatInfo | null>(null)
  const verdict = ref<CheckVerdict | null>(null)
  const running = ref(false)
  const env = collectEnv()

  // Progress: services + NAT step are known upfront; ICE URLs are added once the config loads.
  const done = ref(0)
  const total = ref(services.length + 1)
  const progress = computed(() => Math.min(100, Math.round((done.value / total.value) * 100)))

  async function runRow(
    row: CheckRow,
    probe: () => Promise<{ ok: boolean; ms: number | null; error?: string }>,
  ) {
    row.status = "running"
    const r = await probe()
    row.status = r.ok ? "ok" : "fail"
    row.ms = r.ms
    row.detail = r.error
    done.value++
  }

  async function loadIce(): Promise<void> {
    configRow.status = "running"
    const started = performance.now()
    try {
      entries.value = await fetchIceServers()
      const rows: CheckRow[] = []
      for (const entry of entries.value) {
        if (entry.error) {
          rows.push({
            label: entry.label,
            target: "—",
            kind: "turn",
            status: "fail",
            detail: entry.error,
          })
          continue
        }
        for (const t of expandIceServers(entry.label, entry.iceServers)) {
          const row = reactive<CheckRow>({
            label: t.label,
            target: t.url,
            kind: t.kind,
            status: "idle",
          })
          testByRow.set(row, t)
          rows.push(row)
        }
      }
      ice.value = rows
      total.value += rows.length
      configRow.status = "ok"
      configRow.detail = `${entries.value.length} серверів, ${rows.length} адрес`
    } catch (e) {
      configRow.status = "fail"
      configRow.detail = e instanceof Error ? e.message : String(e)
      ice.value = []
    }
    configRow.ms = Math.round(performance.now() - started)
    done.value++
  }

  async function runIceRow(row: CheckRow): Promise<void> {
    const test = testByRow.get(row)
    if (test) {
      row.status = "running"
      const r = await testIceUrl(test)
      row.status = r.ok ? "ok" : "fail"
      row.ms = r.ms
      row.detail = r.detail
    }
    done.value++
  }

  async function runNat(): Promise<void> {
    // All working STUN URLs in ONE connection (shared local socket) — see analyzeNat().
    const stunOk = ice.value
      .filter((r) => r.kind === "stun" && r.status === "ok")
      .map((r) => r.target)
    if (stunOk.length >= 2) {
      const r = await probeIce({ iceServers: stunOk.map((urls) => ({ urls })) }, "srflx")
      nat.value = {
        verdict: analyzeNat(r.candidates),
        publicIps: publicAddresses(r.candidates),
        servers: stunOk.length,
      }
    } else {
      nat.value = { verdict: "unknown", publicIps: [], servers: stunOk.length }
    }
    done.value++
  }

  function computeVerdict(): CheckVerdict {
    const okCount = (kind: "stun" | "turn") =>
      ice.value.filter((r) => r.kind === kind && r.status === "ok").length
    if (realtimeRow.status !== "ok" || configRow.status !== "ok") return "fail"
    if (okCount("stun") === 0 && okCount("turn") === 0) return "fail"
    if (okCount("turn") > 0 || nat.value?.verdict === "not-symmetric") return "ok"
    return "warn"
  }

  async function run(): Promise<CheckVerdict> {
    running.value = true
    verdict.value = null
    nat.value = null
    done.value = 0
    total.value = services.length + 1
    for (const row of services)
      Object.assign(row, { status: "idle", ms: undefined, detail: undefined })

    await Promise.all([
      ...internetRows.map((row) => runRow(row, () => probeHttp(row.target))),
      runRow(restRow, () => probeHttp(restRow.target)),
      runRow(realtimeRow, () => probeRealtime()),
      loadIce(),
    ])
    await Promise.all(ice.value.map(runIceRow))
    await runNat()

    verdict.value = computeVerdict()
    running.value = false
    return verdict.value
  }

  const pick = ({ label, target, status, ms, detail }: CheckRow) => ({
    label,
    target,
    status,
    ms,
    detail,
  })

  function buildReport(extra: Record<string, unknown> = {}) {
    return {
      ...extra,
      verdict: verdict.value,
      env,
      services: services.map(pick),
      ice: ice.value.map(pick),
      nat: nat.value && { ...nat.value, verdict: NAT_TEXT[nat.value.verdict] },
    }
  }

  /** The admin reads reports in /admin → Звіти діагностики. */
  async function saveReport(extra: Record<string, unknown> = {}): Promise<boolean> {
    const { error } = await supabase.from("diag_reports").insert({ report: buildReport(extra) })
    return !error
  }

  return {
    services,
    ice,
    entries,
    nat,
    verdict,
    running,
    progress,
    env,
    run,
    buildReport,
    saveReport,
  }
}
