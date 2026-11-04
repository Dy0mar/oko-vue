import type { RealtimeChannel } from "@supabase/supabase-js"

import { supabase } from "src/api/supabase"

/** Presence payload of one browser tab in the room. */
export interface PeerInfo {
  /** Random per tab: the same user may open two tabs. */
  peerId: string
  userId: string
  email: string | null
  isAdmin: boolean
  joinedAt: number
}

export interface SignalMessage {
  from: string
  /** peerId or "*" for everyone */
  to: string
  type: string
  data: unknown
}

export type SignalingStatus = "connecting" | "joined" | "error" | "closed"

interface Handlers {
  onSignal: (msg: SignalMessage) => void
  onPeers: (peers: PeerInfo[]) => void
  onStatus: (status: SignalingStatus, error?: string) => void
}

/** Messages from a peer that presence has not reported yet are held this long. */
const UNKNOWN_PEER_HOLD_MS = 5000

/**
 * Signaling over a PRIVATE Supabase Realtime channel `room:<code>`.
 * Only signed-in users can join it, and only for an existing room (RLS on realtime.messages).
 * Broadcast carries offers/answers/candidates; presence tells who is in the room.
 */
/** `watchOnly`: see who is in the room (lobby) without appearing there yourself. */
export function createSignaling(
  code: string,
  self: PeerInfo,
  handlers: Handlers,
  { watchOnly = false }: { watchOnly?: boolean } = {},
) {
  let channel: RealtimeChannel | null = null
  let known = new Set<string>()
  let held: { msg: SignalMessage; at: number }[] = []

  function deliver(msg: SignalMessage) {
    if (msg.to !== self.peerId && msg.to !== "*") return
    if (known.has(msg.from)) {
      handlers.onSignal(msg)
    } else {
      // Presence can lag behind the first broadcast (e.g. the offer). Hold it briefly
      // instead of trusting a sender that is not (yet) a room member.
      held.push({ msg, at: Date.now() })
    }
  }

  function releaseHeld() {
    const now = Date.now()
    const keep: typeof held = []
    for (const h of held) {
      if (known.has(h.msg.from)) handlers.onSignal(h.msg)
      else if (now - h.at < UNKNOWN_PEER_HOLD_MS) keep.push(h)
    }
    held = keep
  }

  async function join(): Promise<void> {
    handlers.onStatus("connecting")
    // Private channels are authorized with the user's JWT.
    await supabase.realtime.setAuth()

    channel = supabase.channel(`room:${code}`, {
      config: {
        private: true,
        broadcast: { self: false },
        presence: { key: self.peerId },
      },
    })

    channel
      .on("broadcast", { event: "signal" }, ({ payload }) => deliver(payload as SignalMessage))
      .on("presence", { event: "sync" }, () => {
        const state = channel!.presenceState<PeerInfo>()
        const peers = Object.values(state)
          .map((metas) => metas[0])
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map(({ peerId, userId, email, isAdmin, joinedAt }) => ({
            peerId,
            userId,
            email,
            isAdmin,
            joinedAt,
          }))
        known = new Set(peers.map((p) => p.peerId))
        releaseHeld()
        handlers.onPeers(peers)
      })
      .subscribe(async (status, err) => {
        if (status === "SUBSCRIBED") {
          if (!watchOnly) await channel!.track(self)
          handlers.onStatus("joined")
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          handlers.onStatus("error", err?.message ?? status)
        } else if (status === "CLOSED") {
          handlers.onStatus("closed")
        }
      })
  }

  function send(to: string, type: string, data: unknown): void {
    if (!channel) return
    const payload: SignalMessage = { from: self.peerId, to, type, data }
    void channel.send({ type: "broadcast", event: "signal", payload })
  }

  async function leave(): Promise<void> {
    if (!channel) return
    const c = channel
    channel = null
    await c.untrack().catch(() => {})
    await supabase.removeChannel(c)
  }

  return { join, send, leave }
}
