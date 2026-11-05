import type { IceServerEntry } from "src/api/iceServers"
import type { CheckVerdict } from "src/composables/useNetworkCheck"

/**
 * Result of the last network check on THIS device. The check is re-run when the admin
 * changes the server list (fingerprint differs) or after MAX_AGE.
 */
const KEY = "oko:network-check:v1"
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface Stored {
  verdict: CheckVerdict
  fingerprint: string
  at: number
}

/** Stable across calls: provider credentials rotate, so only the row id + kind count. */
export function serversFingerprint(entries: IceServerEntry[]): string {
  const text = entries
    .map(
      (e) =>
        `${e.id}:${e.kind === "static" ? JSON.stringify(e.iceServers.map((s) => s.urls)) : e.kind}`,
    )
    .sort()
    .join("|")
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return (hash >>> 0).toString(16)
}

export function loadDeviceCheck(fingerprint: string): CheckVerdict | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as Stored
    if (stored.fingerprint !== fingerprint || Date.now() - stored.at > MAX_AGE_MS) return null
    return stored.verdict
  } catch {
    return null
  }
}

export function saveDeviceCheck(fingerprint: string, verdict: CheckVerdict): void {
  try {
    // A failed check is never cached: the next visit should check again.
    if (verdict === "fail") localStorage.removeItem(KEY)
    else
      localStorage.setItem(
        KEY,
        JSON.stringify({ verdict, fingerprint, at: Date.now() } satisfies Stored),
      )
  } catch {
    // storage unavailable (private mode) — the check just runs every time
  }
}
