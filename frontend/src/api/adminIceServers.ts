import { supabase } from "src/api/supabase"

/** Admin-only (RLS). Regular users get servers through the `ice-servers` edge function. */
export interface IceServerRow {
  id: string
  label: string
  kind: "static" | "cloudflare"
  urls: string[]
  username: string | null
  credential: string | null
  enabled: boolean
  sort: number
}

export type IceServerInput = Omit<IceServerRow, "id">

const COLUMNS = "id, label, kind, urls, username, credential, enabled, sort"

export async function listIceServers(): Promise<IceServerRow[]> {
  const { data, error } = await supabase.from("ice_servers").select(COLUMNS).order("sort")
  if (error) throw error
  return data as IceServerRow[]
}

export async function createIceServer(input: IceServerInput): Promise<void> {
  const { error } = await supabase.from("ice_servers").insert(normalize(input))
  if (error) throw error
}

export async function updateIceServer(id: string, patch: Partial<IceServerInput>): Promise<void> {
  const { error } = await supabase.from("ice_servers").update(patch).eq("id", id)
  if (error) throw error
}

export async function deleteIceServer(id: string): Promise<void> {
  const { error } = await supabase.from("ice_servers").delete().eq("id", id)
  if (error) throw error
}

/** Returns an error message or null. */
export function validateIceServer(input: IceServerInput): string | null {
  if (!input.label.trim()) return "Вкажіть назву"
  if (input.kind === "cloudflare") return null
  if (input.urls.length === 0) return "Додайте хоча б одну адресу"
  const bad = input.urls.find((u) => !/^(stuns?|turns?):[^\s]+$/i.test(u))
  if (bad) return `Невірна адреса: ${bad} (очікується stun:, turn: або turns:)`
  const hasTurn = input.urls.some((u) => /^turns?:/i.test(u))
  if (hasTurn && (!input.username || !input.credential)) return "Для TURN потрібні логін і пароль"
  return null
}

/** "a, b\nc" → ["a","b","c"] */
export function parseUrls(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean)
}

function normalize(input: IceServerInput): IceServerInput {
  const isStatic = input.kind === "static"
  return {
    ...input,
    label: input.label.trim(),
    urls: isStatic ? input.urls : [],
    username: isStatic ? input.username || null : null,
    credential: isStatic ? input.credential || null : null,
  }
}
