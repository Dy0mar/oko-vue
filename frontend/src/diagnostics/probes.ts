/** Network probes used by the diagnostics page (and later by the admin "Test server" button). */

export interface GatheredCandidate {
  type: RTCIceCandidateType | null
  protocol: RTCIceProtocol | null
  address: string | null
  port: number | null
  relatedAddress: string | null
  relatedPort: number | null
}

export interface IceProbeResult {
  ok: boolean
  /** Time until the first candidate of the wanted type, ms. */
  ms: number | null
  candidates: GatheredCandidate[]
  errors: string[]
}

/**
 * Gathers ICE candidates for `config` without any remote peer.
 * STUN works  ⇔ we get a `srflx` candidate (our public address as the server sees it).
 * TURN works  ⇔ we get a `relay` candidate (server allocated a relay port, credentials are valid).
 */
export function probeIce(
  config: RTCConfiguration,
  want: RTCIceCandidateType,
  timeoutMs = 6000,
): Promise<IceProbeResult> {
  return new Promise((resolve) => {
    const started = performance.now()
    const candidates: GatheredCandidate[] = []
    const errors: string[] = []
    let ms: number | null = null
    let done = false

    let pc: RTCPeerConnection
    try {
      pc = new RTCPeerConnection(config)
    } catch (e) {
      resolve({ ok: false, ms: null, candidates, errors: [String(e)] })
      return
    }

    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      pc.close()
      resolve({ ok: ms !== null, ms, candidates, errors })
    }
    const timer = setTimeout(finish, timeoutMs)

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return finish() // gathering complete
      if (!candidate.candidate) return // end-of-candidates marker
      candidates.push({
        type: candidate.type,
        protocol: candidate.protocol,
        address: candidate.address,
        port: candidate.port,
        relatedAddress: candidate.relatedAddress,
        relatedPort: candidate.relatedPort,
      })
      if (candidate.type === want && ms === null) ms = Math.round(performance.now() - started)
    }

    pc.onicecandidateerror = (event) => {
      const e = event as RTCPeerConnectionIceErrorEvent
      // 701 = server unreachable, 401 = bad TURN credentials, etc.
      const text = `${e.url} → ${e.errorCode} ${e.errorText}`.trim()
      // The same error repeats per local interface — keep one copy.
      if (!errors.includes(text)) errors.push(text)
    }

    // A data channel is enough to start ICE gathering — no camera needed.
    pc.createDataChannel("probe")
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch((e) => {
        errors.push(String(e))
        finish()
      })
  })
}

export type NatVerdict = "symmetric" | "not-symmetric" | "unknown"

/**
 * Run with SEVERAL STUN servers in ONE peer connection: they share a local socket.
 * - Same public port for every server  → endpoint-independent NAT, direct P2P is likely.
 * - Different public ports per server  → symmetric NAT, direct P2P usually fails → TURN required.
 * Heuristic: multiple network interfaces can produce false "symmetric".
 */
export function analyzeNat(candidates: GatheredCandidate[]): NatVerdict {
  const srflx = candidates.filter((c) => c.type === "srflx" && c.protocol === "udp" && c.port)
  if (srflx.length === 0) return "unknown"

  const portsByBase = new Map<string, Set<number>>()
  for (const c of srflx) {
    // Browsers may hide the local base address (0.0.0.0 / 0); fall back to the public IP.
    const key = c.relatedPort ? `${c.relatedAddress}:${c.relatedPort}` : `public:${c.address}`
    const ports = portsByBase.get(key) ?? new Set<number>()
    ports.add(c.port!)
    portsByBase.set(key, ports)
  }
  return [...portsByBase.values()].some((ports) => ports.size > 1) ? "symmetric" : "not-symmetric"
}

export function publicAddresses(candidates: GatheredCandidate[]): string[] {
  return [
    ...new Set(
      candidates.filter((c) => c.type === "srflx" && c.address).map((c) => c.address as string),
    ),
  ]
}

export interface ReachResult {
  ok: boolean
  ms: number
  error?: string
}

/**
 * Is the host reachable at the network level?
 * `no-cors` returns an opaque response on success and throws on DNS/TCP/TLS failure or block.
 */
export async function probeHttp(url: string, timeoutMs = 8000): Promise<ReachResult> {
  const started = performance.now()
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) })
    return { ok: true, ms: Math.round(performance.now() - started) }
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - started), error: errorText(e) }
  }
}

export interface MediaCheck {
  ok: boolean
  cameras: number
  microphones: number
  error?: string
}

export async function probeMedia(): Promise<MediaCheck> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    stream.getTracks().forEach((t) => t.stop())
    const devices = await navigator.mediaDevices.enumerateDevices()
    return {
      ok: true,
      cameras: devices.filter((d) => d.kind === "videoinput").length,
      microphones: devices.filter((d) => d.kind === "audioinput").length,
    }
  } catch (e) {
    return { ok: false, cameras: 0, microphones: 0, error: errorText(e) }
  }
}

function errorText(e: unknown): string {
  if (e instanceof DOMException) return `${e.name}: ${e.message}`
  return e instanceof Error ? e.message : String(e)
}
