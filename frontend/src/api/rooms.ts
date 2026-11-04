import { supabase } from "src/api/supabase"

export interface Room {
  code: string
  title: string | null
  created_at: string
}

export const ROOM_CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/

const ALPHABET = "abcdefghijklmnopqrstuvwxyz"

/** Meet-style code `abc-defg-hij` (26^10 ≈ 1.4·10^14 combinations). */
export function generateRoomCode(): string {
  const letters: string[] = []
  while (letters.length < 10) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      // Rejection sampling: 234 = 9·26, keeps every letter equally likely.
      if (byte < 234 && letters.length < 10) letters.push(ALPHABET[byte % 26]!)
    }
  }
  const s = letters.join("")
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`
}

/** Accepts a bare code or a full link (`https://…/meet/abc-defg-hij`). */
export function parseRoomCode(input: string): string | null {
  return /([a-z]{3}-[a-z]{4}-[a-z]{3})/.exec(input.trim().toLowerCase())?.[1] ?? null
}

export function roomLink(code: string): string {
  return `${window.location.origin}/meet/${code}`
}

export async function listRooms(): Promise<Room[]> {
  const { data, error } = await supabase
    .from("rooms")
    .select("code, title, created_at")
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as Room[]
}

export async function getRoom(code: string): Promise<Room | null> {
  const { data, error } = await supabase
    .from("rooms")
    .select("code, title, created_at")
    .eq("code", code)
    .maybeSingle()
  if (error) throw error
  return data as Room | null
}

/** Admin only (RLS). Retries on the (astronomically unlikely) code collision. */
export async function createRoom(title: string | null): Promise<Room> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from("rooms")
      .insert({ code: generateRoomCode(), title: title?.trim() || null })
      .select("code, title, created_at")
      .single()
    if (!error) return data as Room
    if (error.code !== "23505") throw error // 23505 = unique_violation
  }
  throw new Error("Не вдалося згенерувати унікальний код кімнати")
}

export async function deleteRoom(code: string): Promise<void> {
  const { error } = await supabase.from("rooms").delete().eq("code", code)
  if (error) throw error
}
