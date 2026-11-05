/**
 * One RTCPeerConnection to one remote peer, using MDN's "Perfect negotiation" pattern:
 * both sides may start negotiating at any time (e.g. both add tracks on join); on a
 * collision the "polite" side rolls back and accepts the other offer, the "impolite"
 * side ignores the incoming one.
 * https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
 */

export interface PeerOptions {
  remoteId: string
  polite: boolean
  config: RTCConfiguration
  localStream: MediaStream | null
  send: (type: "description" | "candidate", data: unknown) => void
  onStream: (stream: MediaStream) => void
  onState: (state: RTCPeerConnectionState) => void
}

export type Peer = ReturnType<typeof createPeer>

export function createPeer(opts: PeerOptions) {
  const pc = new RTCPeerConnection(opts.config)

  let makingOffer = false
  let ignoreOffer = false
  let isSettingRemoteAnswerPending = false
  /** Candidates that arrived before the remote description. */
  let pendingCandidates: RTCIceCandidateInit[] = []
  /** Signals are processed strictly in arrival order. */
  let queue: Promise<void> = Promise.resolve()

  // --- media ---------------------------------------------------------------
  const local = opts.localStream
  /** Our outgoing video slot: camera or, while sharing, the screen. */
  let videoTransceiver: RTCRtpTransceiver | undefined
  for (const kind of ["audio", "video"] as const) {
    const track = kind === "audio" ? local?.getAudioTracks()[0] : local?.getVideoTracks()[0]
    let transceiver: RTCRtpTransceiver | undefined
    if (track && local) {
      const sender = pc.addTrack(track, local)
      transceiver = pc.getTransceivers().find((t) => t.sender === sender)
    } else {
      // No local device: still ask to RECEIVE this kind from the other side.
      transceiver = pc.addTransceiver(kind, { direction: "recvonly" })
    }
    if (kind === "video") videoTransceiver = transceiver
  }

  pc.ontrack = ({ track, streams }) => {
    opts.onStream(streams[0] ?? new MediaStream([track]))
  }

  // --- negotiation -----------------------------------------------------------
  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true
      await pc.setLocalDescription()
      opts.send("description", pc.localDescription)
    } catch (e) {
      console.warn("[peer] negotiation failed", e)
    } finally {
      makingOffer = false
    }
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) opts.send("candidate", candidate.toJSON())
  }

  pc.onconnectionstatechange = () => {
    opts.onState(pc.connectionState)
    // Network changed or the path died: look for a new one without dropping the call.
    // Only one side restarts: simultaneous restart offers collide and the rollback
    // on the polite side could break one media direction.
    if (pc.connectionState === "failed" && !opts.polite) pc.restartIce()
  }

  async function onDescription(description: RTCSessionDescriptionInit): Promise<void> {
    const readyForOffer =
      !makingOffer && (pc.signalingState === "stable" || isSettingRemoteAnswerPending)
    const offerCollision = description.type === "offer" && !readyForOffer
    ignoreOffer = !opts.polite && offerCollision
    if (ignoreOffer) return

    isSettingRemoteAnswerPending = description.type === "answer"
    await pc.setRemoteDescription(description) // polite side rolls back implicitly
    isSettingRemoteAnswerPending = false

    const pending = pendingCandidates
    pendingCandidates = []
    for (const c of pending) await addCandidate(c)

    if (description.type === "offer") {
      await pc.setLocalDescription()
      opts.send("description", pc.localDescription)
    }
  }

  async function addCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!pc.remoteDescription) {
      pendingCandidates.push(candidate)
      return
    }
    try {
      await pc.addIceCandidate(candidate)
    } catch (e) {
      if (!ignoreOffer) console.warn("[peer] addIceCandidate failed", e)
    }
  }

  function handle(type: string, data: unknown): void {
    queue = queue
      .then(() => {
        if (type === "description") return onDescription(data as RTCSessionDescriptionInit)
        if (type === "candidate") return addCandidate(data as RTCIceCandidateInit)
      })
      .catch((e) => console.warn(`[peer] ${type} failed`, e))
  }

  function close(): void {
    pc.ontrack = pc.onicecandidate = pc.onnegotiationneeded = pc.onconnectionstatechange = null
    pc.close()
  }

  /**
   * Swap what we send as video (camera ↔ screen) without renegotiation.
   * Only a slot created as receive-only (no camera) has to start sending: that one renegotiates,
   * which perfect negotiation handles.
   */
  async function setVideoTrack(track: MediaStreamTrack | null, isScreen = false): Promise<void> {
    const t = videoTransceiver
    if (!t || pc.signalingState === "closed") return
    if (track && t.direction === "recvonly") t.direction = "sendrecv"
    await t.sender.replaceTrack(track)
    try {
      // Screen: keep text sharp — drop frames rather than resolution on a weak link.
      const params = t.sender.getParameters()
      params.degradationPreference = isScreen ? "maintain-resolution" : "balanced"
      await t.sender.setParameters(params)
    } catch {
      // not negotiated yet / not supported — the default is fine
    }
  }

  return { pc, remoteId: opts.remoteId, handle, setVideoTrack, close }
}
