import { probeIce } from "src/diagnostics/probes"
import { describeIceUrl } from "src/diagnostics/targets"

/** One URL of one configured server: STUN and every TURN transport are tested separately. */
export interface IceUrlTest {
  label: string
  url: string
  kind: "stun" | "turn"
  /** Single-URL server incl. credentials — keep it out of reports. */
  server: RTCIceServer
}

export interface IceTestResult {
  ok: boolean
  ms: number | null
  /** Public/relay address on success, the ICE error on failure. */
  detail: string
}

export function expandIceServers(label: string, iceServers: RTCIceServer[]): IceUrlTest[] {
  return iceServers.flatMap((server) =>
    (Array.isArray(server.urls) ? server.urls : [server.urls]).map((url) => {
      const kind = url.startsWith("stun") ? "stun" : "turn"
      return {
        label: kind === "turn" ? `${label} · ${describeIceUrl(url)}` : label,
        url,
        kind,
        server: { ...server, urls: [url] },
      } satisfies IceUrlTest
    }),
  )
}

/**
 * STUN works ⇔ a `srflx` candidate (our public address) arrives.
 * TURN works ⇔ a `relay` candidate arrives with relay-only policy, i.e. media really can go through it.
 */
export async function testIceUrl(test: IceUrlTest): Promise<IceTestResult> {
  const isTurn = test.kind === "turn"
  const want = isTurn ? "relay" : "srflx"
  const r = await probeIce(
    { iceServers: [test.server], iceTransportPolicy: isTurn ? "relay" : "all" },
    want,
    isTurn ? 10000 : 6000,
  )
  const detail = r.ok
    ? [...new Set(r.candidates.filter((c) => c.type === want).map((c) => c.address))].join(", ")
    : r.errors.join("; ") || "немає відповіді"
  return { ok: r.ok, ms: r.ms, detail }
}
