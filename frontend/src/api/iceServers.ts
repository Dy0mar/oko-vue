import { supabase } from "src/api/supabase"
import type { IceKind } from "src/api/iceProviders"

/** One configured server (admin's `ice_servers` row), as returned by the `ice-servers` edge function. */
export interface IceServerEntry {
  id: string
  label: string
  kind: IceKind
  iceServers: RTCIceServer[]
  /** Set when the server could not be prepared (e.g. provider secrets missing). */
  error?: string
}

export async function fetchIceServers(): Promise<IceServerEntry[]> {
  const { data, error } = await supabase.functions.invoke<{ servers: IceServerEntry[] }>(
    "ice-servers",
  )
  if (error) throw error
  return data?.servers ?? []
}

/** Flat list for `new RTCPeerConnection({ iceServers })`. */
export function toRtcIceServers(entries: IceServerEntry[]): RTCIceServer[] {
  return entries.flatMap((e) => e.iceServers)
}
