export interface Target {
  label: string
  url: string
}

/** Generic "is there internet at all" check. STUN/TURN servers come from the admin config (DB). */
export const HTTP_TARGETS: Target[] = [
  { label: "Інтернет (Google)", url: "https://www.google.com/generate_204" },
]

/** Human-readable transport of an ICE URL: "UDP 3478", "TLS 443", … */
export function describeIceUrl(url: string): string {
  const m = /^(stuns?|turns?):[^:?]+(?::(\d+))?(?:\?transport=(udp|tcp))?/i.exec(url)
  if (!m) return url
  const [, scheme = "", port, transport] = m
  const secure = scheme.toLowerCase().endsWith("s")
  const defaultPort = secure ? "5349" : "3478"
  const proto = secure ? "TLS" : (transport ?? "udp").toUpperCase()
  return `${proto} ${port ?? defaultPort}`
}
