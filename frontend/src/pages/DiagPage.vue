<script setup lang="ts">
import { computed, reactive, ref, shallowRef } from "vue"
import Button from "primevue/button"
import Card from "primevue/card"
import Message from "primevue/message"
import Tag from "primevue/tag"
import Textarea from "primevue/textarea"

import { supabase } from "src/api/supabase"
import { fetchIceServers } from "src/api/iceServers"
import AppHeader from "src/components/AppHeader.vue"
import { expandIceServers, testIceUrl, type IceUrlTest } from "src/diagnostics/ice"
import {
  analyzeNat,
  probeHttp,
  probeIce,
  probeMedia,
  publicAddresses,
  type MediaCheck,
  type NatVerdict,
} from "src/diagnostics/probes"
import { probeRealtime } from "src/diagnostics/realtime"
import { HTTP_TARGETS } from "src/diagnostics/targets"

type Status = "idle" | "running" | "ok" | "fail"

interface Row {
  label: string
  target: string
  status: Status
  ms?: number | null
  detail?: string
}

interface IceRow extends Row {
  kind: IceUrlTest["kind"]
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

// --- environment ---------------------------------------------------------
const connection = (navigator as Navigator & { connection?: Record<string, unknown> }).connection
const env = {
  time: new Date().toISOString(),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  userAgent: navigator.userAgent,
  secureContext: window.isSecureContext,
  webrtc: "RTCPeerConnection" in window,
  network: connection
    ? { type: connection.effectiveType, downlinkMbps: connection.downlink, rttMs: connection.rtt }
    : "n/a",
}

// --- state -----------------------------------------------------------------
const serviceRows = reactive<Row[]>([
  ...HTTP_TARGETS.map((t) => ({ label: t.label, target: t.url, status: "idle" as Status })),
  { label: "Supabase (REST)", target: `${supabaseUrl}/auth/v1/health`, status: "idle" },
  { label: "Supabase Realtime (канал)", target: `${supabaseUrl}/realtime/v1`, status: "idle" },
  { label: "Конфігурація серверів", target: "edge function ice-servers", status: "idle" },
])
const [internetRows, restRow, realtimeRow, configRow] = [
  serviceRows.slice(0, HTTP_TARGETS.length),
  serviceRows[HTTP_TARGETS.length]!,
  serviceRows[HTTP_TARGETS.length + 1]!,
  serviceRows[HTTP_TARGETS.length + 2]!,
]

const iceRows = ref<IceRow[]>([])
/** Credentials stay out of reactive rows and out of the report. */
const testByRow = new WeakMap<object, IceUrlTest>()

const nat = ref<{ verdict: NatVerdict; publicIps: string[]; servers: number } | null>(null)
const media = shallowRef<MediaCheck | null>(null)
const running = ref(false)
const saved = ref<"idle" | "ok" | "fail">("idle")

async function runRow(
  row: Row,
  probe: () => Promise<{ ok: boolean; ms: number | null; error?: string }>,
) {
  row.status = "running"
  const r = await probe()
  row.status = r.ok ? "ok" : "fail"
  row.ms = r.ms
  row.detail = r.error
}

/** Loads the admin's server list and expands it into one row per URL. */
async function loadIceRows(): Promise<void> {
  configRow.status = "running"
  const started = performance.now()
  try {
    const entries = await fetchIceServers()
    const rows: IceRow[] = []
    for (const entry of entries) {
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
        const row = reactive<IceRow>({
          label: t.label,
          target: t.url,
          kind: t.kind,
          status: "idle",
        })
        testByRow.set(row, t)
        rows.push(row)
      }
    }
    iceRows.value = rows
    configRow.status = "ok"
    configRow.detail = `${entries.length} серверів, ${rows.length} адрес`
  } catch (e) {
    configRow.status = "fail"
    configRow.detail = e instanceof Error ? e.message : String(e)
    iceRows.value = []
  }
  configRow.ms = Math.round(performance.now() - started)
}

async function runIceRow(row: IceRow): Promise<void> {
  const test = testByRow.get(row)
  if (!test) return // row from a failed entry, already marked
  row.status = "running"
  const r = await testIceUrl(test)
  row.status = r.ok ? "ok" : "fail"
  row.ms = r.ms
  row.detail = r.detail
}

async function runAll() {
  running.value = true
  saved.value = "idle"
  nat.value = null

  await Promise.all([
    ...internetRows.map((row) => runRow(row, () => probeHttp(row.target))),
    runRow(restRow, () => probeHttp(restRow.target)),
    runRow(realtimeRow, () => probeRealtime()),
    loadIceRows(),
  ])
  await Promise.all(iceRows.value.map(runIceRow))

  // NAT type: all working STUN URLs in ONE connection (shared local socket).
  const stunOk = iceRows.value
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

  running.value = false
  await saveReport()
}

async function runMedia() {
  media.value = await probeMedia()
}

// --- report ----------------------------------------------------------------
const natText: Record<NatVerdict, string> = {
  "not-symmetric": "НЕ симетричний: пряме з'єднання ймовірно можливе",
  symmetric: "СИМЕТРИЧНИЙ: пряме з'єднання навряд чи спрацює, потрібен TURN",
  unknown: "невідомо (потрібно ≥2 робочих STUN)",
}

const pick = ({ label, target, status, ms, detail }: Row) => ({ label, target, status, ms, detail })

const report = computed(() => ({
  env,
  services: serviceRows.map(pick),
  ice: iceRows.value.map(pick),
  nat: nat.value && { ...nat.value, verdict: natText[nat.value.verdict] },
  media: media.value,
}))
const reportText = computed(() => JSON.stringify(report.value, null, 2))

/** Admin reads reports in the DB (diag_reports) — no copy-paste needed. */
async function saveReport() {
  const { error } = await supabase.from("diag_reports").insert({ report: report.value })
  saved.value = error ? "fail" : "ok"
}

const copied = ref(false)
async function copyReport() {
  await navigator.clipboard.writeText(reportText.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

const tag: Record<Status, { value: string; severity: string }> = {
  idle: { value: "—", severity: "secondary" },
  running: { value: "…", severity: "info" },
  ok: { value: "OK", severity: "success" },
  fail: { value: "FAIL", severity: "danger" },
}

const stunRows = computed(() => iceRows.value.filter((r) => r.kind === "stun"))
const turnRows = computed(() => iceRows.value.filter((r) => r.kind === "turn"))
const sections = computed(() => [
  { title: "Сервіси", rows: serviceRows, empty: "" },
  { title: "STUN-сервери", rows: stunRows.value, empty: "ще не перевірено" },
  { title: "TURN-сервери", rows: turnRows.value, empty: "ще не перевірено" },
])
</script>

<template>
  <main class="mx-auto flex max-w-4xl flex-col gap-4 p-4">
    <AppHeader title="Діагностика мережі" />

    <p class="text-muted-color">
      Перевіряє, чи доступні з цієї мережі сервіси OKO та сервери для з'єднання. Натисніть
      «Запустити»: результат автоматично отримає адміністратор.
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <Button label="Запустити" icon="pi pi-play" :loading="running" @click="runAll" />
      <Button label="Камера й мікрофон" icon="pi pi-video" severity="secondary" @click="runMedia" />
      <Button
        :label="copied ? 'Скопійовано' : 'Скопіювати звіт'"
        icon="pi pi-copy"
        severity="secondary"
        @click="copyReport"
      />
      <span v-if="saved === 'ok'" class="text-sm text-green-400">
        <i class="pi pi-check" /> Звіт надіслано адміну
      </span>
      <span v-else-if="saved === 'fail'" class="text-sm text-red-400">
        Не вдалося надіслати звіт — скопіюйте його вручну
      </span>
    </div>

    <Message v-if="!env.webrtc" severity="error">Браузер не підтримує WebRTC.</Message>

    <Card>
      <template #title>Тип NAT</template>
      <template #content>
        <p v-if="!nat" class="text-muted-color">ще не перевірено</p>
        <template v-else>
          <Message
            :severity="
              nat.verdict === 'not-symmetric'
                ? 'success'
                : nat.verdict === 'symmetric'
                  ? 'warn'
                  : 'secondary'
            "
          >
            {{ natText[nat.verdict] }}
          </Message>
          <p class="mt-2 text-muted-color">
            Публічні IP: {{ nat.publicIps.join(", ") || "—" }} · робочих STUN: {{ nat.servers }}
          </p>
        </template>
      </template>
    </Card>

    <Card v-for="section in sections" :key="section.title">
      <template #title>{{ section.title }}</template>
      <template #content>
        <p v-if="section.rows.length === 0" class="text-muted-color">{{ section.empty }}</p>
        <table v-else class="w-full">
          <tr v-for="row in section.rows" :key="row.label + row.target" class="diag-row">
            <td class="w-px whitespace-nowrap"><Tag v-bind="tag[row.status]" /></td>
            <td>
              {{ row.label }}
              <div class="text-sm text-muted-color">{{ row.target }}</div>
            </td>
            <td class="text-right whitespace-nowrap">{{ row.ms != null ? `${row.ms} мс` : "" }}</td>
            <td class="text-sm">{{ row.detail }}</td>
          </tr>
        </table>
      </template>
    </Card>

    <Card>
      <template #title>Камера й мікрофон</template>
      <template #content>
        <p v-if="!media" class="text-muted-color">ще не перевірено</p>
        <Message v-else :severity="media.ok ? 'success' : 'error'">
          {{
            media.ok
              ? `Доступ є · камер: ${media.cameras} · мікрофонів: ${media.microphones}`
              : media.error
          }}
        </Message>
      </template>
    </Card>

    <Card>
      <template #title>Звіт</template>
      <template #content>
        <Textarea :model-value="reportText" readonly rows="12" class="w-full font-mono text-xs" />
      </template>
    </Card>
  </main>
</template>
