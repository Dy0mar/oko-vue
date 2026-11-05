import { computed, markRaw, onBeforeUnmount, reactive, ref, watch } from "vue"

import { useAuth } from "src/composables/useAuth"
import type { LocalMedia } from "src/composables/call/useLocalMedia"
import { toRtcIceServers, type IceServerEntry } from "src/api/iceServers"
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

/** `media` is owned by the meeting page: the preview camera continues into the call. */
/**
 * How media may travel. "auto": direct when possible, TURN as fallback.
 * "relay": TURN only — through every TURN server (serverId null) or one specific server.
 */
export type MediaRoute = { mode: "auto" } | { mode: "relay"; serverId: string | null }

const hasTurn = (e: IceServerEntry) =>
  e.iceServers.some((s) =>
    (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith("turn")),
  )

export function useCall(code: string, entries: IceServerEntry[], media: LocalMedia) {
  const auth = useAuth()

  const status = ref<CallStatus>("idle")
  const error = ref<string | null>(null)
  const route = ref<MediaRoute>({ mode: "auto" })
  /** TURN servers this participant has credentials for (for the admin route picker). */
  const turnServers = entries.filter(hasTurn).map(({ id, label }) => ({ id, label }))
  const remotes = ref<RemoteView[]>([])

  /**
   * One connection per remote peer. Every RTCPeerConnection has its own session id (`sid`),
   * sent with each description/candidate, so messages of an already closed connection
   * (e.g. right after a route switch) are never fed into its replacement.
   */
  interface Conn {
    peer: Peer
    sample: () => Promise<ConnStats>
    sid: string
    /** sid of the remote connection we are negotiating with (set by its first message). */
    remoteSid: string | null
    /** Remote sids that belong to connections we have already replaced. */
    deadSids: Set<string>
  }
  const peers = new Map<string, Conn>()
  const self: PeerInfo = {
    peerId: crypto.randomUUID(),
    userId: auth.user.value?.id ?? "",
    email: auth.user.value?.email ?? null,
    isAdmin: auth.isAdmin.value,
    joinedAt: Date.now(),
  }

  function config(): RTCConfiguration {
    const r = route.value
    if (r.mode === "auto")
      return { iceServers: toRtcIceServers(entries), iceTransportPolicy: "all" }
    // One server: each participant uses ITS OWN credentials for that server id.
    const chosen = r.serverId ? entries.filter((e) => e.id === r.serverId) : []
    const pool = chosen.length ? chosen : entries
    return { iceServers: toRtcIceServers(pool), iceTransportPolicy: "relay" }
  }
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
    connect(remote, new Set())
    // Tell the newcomer our mic/cam state.
    signaling.send(info.peerId, "media", { micOn: media.micOn.value, camOn: media.camOn.value })
  }

  /** (Re)creates the RTCPeerConnection for a remote participant, keeping its view. */
  function connect(remote: RemoteView, deadSids: Set<string>): void {
    const sid = crypto.randomUUID()
    const peer = createPeer({
      remoteId: remote.peerId,
      // Deterministic roles for perfect negotiation.
      polite: self.peerId > remote.peerId,
      config: config(),
      localStream: media.stream.value,
      send: (type, data) => signaling.send(remote.peerId, type, { sid, data }),
      onStream: (stream) => (remote.stream = markRaw(stream)),
      onState: (state) => (remote.state = state),
    })
    peers.set(remote.peerId, {
      peer,
      sample: createStatsSampler(peer.pc),
      sid,
      remoteSid: null,
      deadSids,
    })
  }

  /** New connection with the current config; messages of the old one become dead. */
  function reconnect(peerId: string): void {
    const conn = peers.get(peerId)
    const remote = view(peerId)
    if (!conn || !remote) return
    conn.peer.close()
    if (conn.remoteSid) conn.deadSids.add(conn.remoteSid)
    remote.state = "new"
    remote.stats = null
    connect(remote, conn.deadSids)
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
        routeToConnection(msg)
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
      case "media-route":
        applyRoute(msg.data as MediaRoute)
        break
    }
  }

  function routeToConnection(msg: SignalMessage): void {
    const { sid, data } = msg.data as { sid: string; data: unknown }
    ensurePeer({ peerId: msg.from })
    let conn = peers.get(msg.from)!
    if (conn.deadSids.has(sid)) return // from a connection we already replaced
    if (conn.remoteSid && conn.remoteSid !== sid) {
      // The remote side started a NEW connection (route switch, page reload): follow it.
      const isOffer =
        msg.type === "description" && (data as RTCSessionDescriptionInit).type === "offer"
      if (!isOffer) return
      reconnect(msg.from)
      conn = peers.get(msg.from)!
    }
    conn.remoteSid = sid
    conn.peer.handle(msg.type, data)
  }

  // --- admin: route switch -----------------------------------------------------
  // An ICE restart on a live connection does not reliably move Chrome to new relay pairs
  // (the new pairs stay "waiting" while the old host pair keeps working), so a route switch
  // rebuilds the connections: ~1–2 s of frozen video, but the route is guaranteed.
  function applyRoute(next: MediaRoute): void {
    if (JSON.stringify(next) === JSON.stringify(route.value)) return
    route.value = next
    for (const peerId of peers.keys()) reconnect(peerId)
  }

  /** Admin only: switch the media route for everyone in the call (connections are rebuilt). */
  function setRoute(next: MediaRoute): void {
    if (!auth.isAdmin.value) return
    signaling.send("*", "media-route", next)
    applyRoute(next)
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
    if (!media.stream.value) await media.start()
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

  return { status, error, media, remotes, route, turnServers, anyConnected, join, leave, setRoute }
}
