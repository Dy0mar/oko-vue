import { computed, markRaw, onBeforeUnmount, reactive, ref, watch } from "vue"

import { useAuth } from "src/composables/useAuth"
import { useLocalMedia } from "src/composables/call/useLocalMedia"
import { createPeer, type Peer } from "src/composables/call/peer"
import { createSignaling, type PeerInfo, type SignalMessage } from "src/composables/call/signaling"
import { createStatsSampler, type ConnStats, type Quality } from "src/composables/call/stats"

/** 2 people is the goal, 3 the hard limit (full mesh). */
export const MAX_PARTICIPANTS = 3
const STATS_INTERVAL_MS = 2000

export type CallStatus = "idle" | "joining" | "in-call" | "full" | "error" | "left"

/** What the UI renders for one remote participant. */
export interface RemoteView {
  peerId: string
  email: string | null
  isAdmin: boolean
  stream: MediaStream | null
  state: RTCPeerConnectionState
  micOn: boolean
  camOn: boolean
  /** How WE receive them. */
  stats: ConnStats | null
  /** How THEY receive us (reported by them). */
  theirQuality: Quality
}

export function useCall(code: string, iceServers: RTCIceServer[]) {
  const auth = useAuth()
  const media = useLocalMedia()

  const status = ref<CallStatus>("idle")
  const error = ref<string | null>(null)
  const policy = ref<RTCIceTransportPolicy>("all")
  const remotes = ref<RemoteView[]>([])

  const peers = new Map<string, { peer: Peer; sample: () => Promise<ConnStats> }>()
  const self: PeerInfo = {
    peerId: crypto.randomUUID(),
    userId: auth.user.value?.id ?? "",
    email: auth.user.value?.email ?? null,
    isAdmin: auth.isAdmin.value,
    joinedAt: Date.now(),
  }

  const config = (): RTCConfiguration => ({ iceServers, iceTransportPolicy: policy.value })
  const view = (peerId: string) => remotes.value.find((r) => r.peerId === peerId)

  const signaling = createSignaling(code, self, {
    onSignal: handleSignal,
    onPeers: syncPeers,
    onStatus: (s, e) => {
      if (s === "joined" && status.value === "joining") status.value = "in-call"
      if (s === "error") {
        status.value = "error"
        error.value = `Не вдалося підключитися до кімнати (${e})`
      }
    },
  })

  // --- peers -------------------------------------------------------------------
  function ensurePeer(info: Pick<PeerInfo, "peerId"> & Partial<PeerInfo>): void {
    if (peers.has(info.peerId)) return
    const remote: RemoteView = reactive({
      peerId: info.peerId,
      email: info.email ?? null,
      isAdmin: info.isAdmin ?? false,
      stream: null,
      state: "new",
      micOn: true,
      camOn: true,
      stats: null,
      theirQuality: "unknown",
    })
    remotes.value = [...remotes.value, remote]

    const peer = createPeer({
      remoteId: info.peerId,
      // Deterministic roles for perfect negotiation.
      polite: self.peerId > info.peerId,
      config: config(),
      localStream: media.stream.value,
      send: (type, data) => signaling.send(info.peerId, type, data),
      onStream: (stream) => (remote.stream = markRaw(stream)),
      onState: (state) => (remote.state = state),
    })
    peers.set(info.peerId, { peer, sample: createStatsSampler(peer.pc) })
    // Tell the newcomer our mic/cam state.
    signaling.send(info.peerId, "media", { micOn: media.micOn.value, camOn: media.camOn.value })
  }

  function dropPeer(peerId: string): void {
    peers.get(peerId)?.peer.close()
    peers.delete(peerId)
    remotes.value = remotes.value.filter((r) => r.peerId !== peerId)
  }

  function syncPeers(all: PeerInfo[]): void {
    // Room full: the latest joiners beyond the limit leave.
    const ordered = [...all].sort(
      (a, b) => a.joinedAt - b.joinedAt || a.peerId.localeCompare(b.peerId),
    )
    const rank = ordered.findIndex((p) => p.peerId === self.peerId)
    if (rank >= MAX_PARTICIPANTS) {
      status.value = "full"
      void leave("full")
      return
    }
    const allowed = ordered.slice(0, MAX_PARTICIPANTS).filter((p) => p.peerId !== self.peerId)
    const ids = new Set(allowed.map((p) => p.peerId))
    for (const id of peers.keys()) if (!ids.has(id)) dropPeer(id)
    for (const p of allowed) {
      ensurePeer(p)
      const v = view(p.peerId)
      if (v) Object.assign(v, { email: p.email, isAdmin: p.isAdmin })
    }
  }

  function handleSignal(msg: SignalMessage): void {
    switch (msg.type) {
      case "description":
      case "candidate":
        ensurePeer({ peerId: msg.from })
        peers.get(msg.from)?.peer.handle(msg.type, msg.data)
        break
      case "media": {
        const v = view(msg.from)
        if (v) Object.assign(v, msg.data as { micOn: boolean; camOn: boolean })
        break
      }
      case "quality": {
        const v = view(msg.from)
        if (v) v.theirQuality = (msg.data as { quality: Quality }).quality
        break
      }
      case "ice-policy":
        applyPolicy((msg.data as { policy: RTCIceTransportPolicy }).policy)
        break
    }
  }

  // --- admin: route switch -----------------------------------------------------
  function applyPolicy(next: RTCIceTransportPolicy): void {
    if (next === policy.value) return
    policy.value = next
    for (const { peer } of peers.values()) peer.reconfigure(config())
  }

  /** Admin only: "all" (direct when possible) ↔ "relay" (TURN only), for everyone in the call. */
  function setPolicy(next: RTCIceTransportPolicy): void {
    if (!auth.isAdmin.value) return
    signaling.send("*", "ice-policy", { policy: next })
    applyPolicy(next)
  }

  // --- stats -------------------------------------------------------------------
  let statsTimer: ReturnType<typeof setInterval> | undefined
  async function collectStats(): Promise<void> {
    for (const [peerId, { sample }] of peers) {
      try {
        const stats = await sample()
        const v = view(peerId)
        if (v) v.stats = stats
        // Share how we receive them, so they can show "your connection at the other side".
        signaling.send(peerId, "quality", { quality: stats.quality })
      } catch {
        // peer closed meanwhile
      }
    }
  }

  // --- lifecycle -----------------------------------------------------------------
  watch([media.micOn, media.camOn], ([micOn, camOn]) =>
    signaling.send("*", "media", { micOn, camOn }),
  )

  async function join(): Promise<void> {
    if (status.value === "joining" || status.value === "in-call") return
    status.value = "joining"
    error.value = null
    await media.start()
    await signaling.join()
    statsTimer = setInterval(() => void collectStats(), STATS_INTERVAL_MS)
  }

  async function leave(reason: CallStatus = "left"): Promise<void> {
    clearInterval(statsTimer)
    for (const id of peers.keys()) dropPeer(id)
    await signaling.leave()
    media.stop()
    if (status.value !== "full" && status.value !== "error") status.value = reason
  }

  onBeforeUnmount(() => void leave())

  const anyConnected = computed(() => remotes.value.some((r) => r.state === "connected"))

  return { status, error, media, remotes, policy, anyConnected, join, leave, setPolicy }
}
