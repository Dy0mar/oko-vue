import { supabase } from "src/api/supabase"
import type { ReachResult } from "src/diagnostics/probes"

/**
 * Subscribes to a throwaway Realtime channel — the same path the call signaling will use
 * (WebSocket + JWT of the signed-in user).
 */
export function probeRealtime(timeoutMs = 8000): Promise<ReachResult> {
  return new Promise((resolve) => {
    const started = performance.now()
    const channel = supabase.channel(`oko:diag:${crypto.randomUUID()}`)
    let done = false

    const finish = (result: Omit<ReachResult, "ms">) => {
      if (done) return
      done = true
      clearTimeout(timer)
      void supabase.removeChannel(channel)
      resolve({ ...result, ms: Math.round(performance.now() - started) })
    }
    const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), timeoutMs)

    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") finish({ ok: true })
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        finish({ ok: false, error: err?.message ?? status })
      }
    })
  })
}
