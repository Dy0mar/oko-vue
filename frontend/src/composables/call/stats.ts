export type Quality = "good" | "fair" | "poor" | "unknown"

export interface ConnStats {
  /** direct = P2P over the internet, local = same network, relay = through TURN */
  route: "direct" | "local" | "relay" | null
  /** e.g. "srflx udp" */
  localCandidate: string | null
  remoteCandidate: string | null
  /** STUN/TURN server that produced our selected candidate (Chrome reports it). */
  server: string | null
  rttMs: number | null
  inKbps: number | null
  outKbps: number | null
  /** Incoming packet loss over the last interval, %. */
  lossPct: number | null
  video: { width: number; height: number; fps: number } | null
  quality: Quality
}

export function qualityOf(rttMs: number | null, lossPct: number | null): Quality {
  if (rttMs === null && lossPct === null) return "unknown"
  const rtt = rttMs ?? 0
  const loss = lossPct ?? 0
  if (loss > 8 || rtt > 400) return "poor"
  if (loss > 2 || rtt > 200) return "fair"
  return "good"
}

type StatsMap = Map<string, Record<string, unknown>>

function selectedPair(report: StatsMap): Record<string, unknown> | undefined {
  for (const s of report.values()) {
    if (s.type === "transport" && typeof s.selectedCandidatePairId === "string") {
      return report.get(s.selectedCandidatePairId)
    }
  }
  // Firefox has no transport.selectedCandidatePairId
  for (const s of report.values()) {
    if (
      s.type === "candidate-pair" &&
      (s.selected === true || (s.nominated && s.state === "succeeded"))
    ) {
      return s
    }
  }
  return undefined
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0)

/** Returns a sampler; each call compares with the previous sample to get rates. */
export function createStatsSampler(pc: RTCPeerConnection) {
  let prev: {
    at: number
    inBytes: number
    outBytes: number
    lost: number
    received: number
  } | null = null

  return async function sample(): Promise<ConnStats> {
    const report = (await pc.getStats()) as unknown as StatsMap
    const pair = selectedPair(report)
    const local = pair ? report.get(pair.localCandidateId as string) : undefined
    const remote = pair ? report.get(pair.remoteCandidateId as string) : undefined

    let inBytes = 0,
      outBytes = 0,
      lost = 0,
      received = 0
    let video: ConnStats["video"] = null
    for (const s of report.values()) {
      if (s.type === "inbound-rtp") {
        inBytes += num(s.bytesReceived)
        lost += num(s.packetsLost)
        received += num(s.packetsReceived)
        if (s.kind === "video" && s.frameWidth) {
          video = {
            width: num(s.frameWidth),
            height: num(s.frameHeight),
            fps: Math.round(num(s.framesPerSecond)),
          }
        }
      } else if (s.type === "outbound-rtp") {
        outBytes += num(s.bytesSent)
      }
    }

    const now = performance.now()
    let inKbps: number | null = null,
      outKbps: number | null = null,
      lossPct: number | null = null
    if (prev) {
      const sec = (now - prev.at) / 1000
      // Counters restart when RTP streams are renegotiated (e.g. after an ICE restart):
      // a negative delta means "no data for this interval", not a negative rate.
      const rate = (now: number, before: number) =>
        now >= before ? Math.round(((now - before) * 8) / 1000 / sec) : null
      inKbps = rate(inBytes, prev.inBytes)
      outKbps = rate(outBytes, prev.outBytes)
      const dLost = lost - prev.lost
      const dReceived = received - prev.received
      const dTotal = dLost + dReceived
      lossPct =
        dLost >= 0 && dReceived >= 0 && dTotal > 0
          ? Math.round((dLost / dTotal) * 1000) / 10
          : dTotal === 0
            ? 0
            : null
    }
    prev = { at: now, inBytes, outBytes, lost, received }

    const types = [local?.candidateType, remote?.candidateType]
    const route: ConnStats["route"] = !pair
      ? null
      : types.includes("relay")
        ? "relay"
        : types.every((t) => t === "host")
          ? "local"
          : "direct"
    const rttMs =
      typeof pair?.currentRoundTripTime === "number"
        ? Math.round(pair.currentRoundTripTime * 1000)
        : null
    const describe = (c?: Record<string, unknown>) =>
      c ? `${c.candidateType} ${c.relayProtocol ?? c.protocol ?? ""}`.trim() : null

    return {
      route,
      localCandidate: describe(local),
      remoteCandidate: describe(remote),
      server: (local?.url as string | undefined) ?? null,
      rttMs,
      inKbps,
      outKbps,
      lossPct,
      video,
      quality: pair ? qualityOf(rttMs, lossPct) : "unknown",
    }
  }
}
