// GET/POST /functions/v1/ice-servers → ICE servers for the signed-in user.
//
// Reads enabled rows from `ice_servers` (admin-only table, read here with the admin client)
// and, for `cloudflare` rows, generates short-lived TURN credentials via the Cloudflare API.
// The Cloudflare token never leaves the server.
//
// Secrets (optional; without them Cloudflare rows are reported as skipped):
//   supabase secrets set CF_TURN_KEY_ID=... CF_TURN_API_TOKEN=...
// Locally: put them into supabase/functions/.env

import "@supabase/functions-js/edge-runtime.d.ts"
import { withSupabase } from "@supabase/server"

interface IceServerRow {
  id: string
  label: string
  kind: "static" | "cloudflare"
  urls: string[]
  username: string | null
  credential: string | null
}

interface ServerEntry {
  id: string
  label: string
  kind: IceServerRow["kind"]
  iceServers: RTCIceServer[]
  /** Why the server is unavailable (e.g. Cloudflare secrets missing). */
  error?: string
}

/** Credentials lifetime. Must outlive the longest call; the client can refresh earlier. */
const CF_TTL_SECONDS = 4 * 60 * 60

export default {
  fetch: withSupabase({ auth: "user" }, async (_req, ctx) => {
    const { data, error } = await ctx.supabaseAdmin
      .from("ice_servers")
      .select("id, label, kind, urls, username, credential")
      .eq("enabled", true)
      .order("sort")

    if (error) {
      console.error("ice_servers select failed", error)
      return Response.json({ error: "failed to load ice servers" }, { status: 500 })
    }

    const servers = await Promise.all((data as IceServerRow[]).map(toEntry))
    return Response.json({ servers, ttl: CF_TTL_SECONDS })
  }),
}

async function toEntry(row: IceServerRow): Promise<ServerEntry> {
  const base = { id: row.id, label: row.label, kind: row.kind }
  if (row.kind === "static") {
    const server: RTCIceServer = { urls: row.urls }
    if (row.username) server.username = row.username
    if (row.credential) server.credential = row.credential
    return { ...base, iceServers: [server] }
  }
  try {
    return { ...base, iceServers: await cloudflareIceServers() }
  } catch (e) {
    console.error("cloudflare turn failed", e)
    return { ...base, iceServers: [], error: e instanceof Error ? e.message : String(e) }
  }
}

async function cloudflareIceServers(): Promise<RTCIceServer[]> {
  const keyId = Deno.env.get("CF_TURN_KEY_ID")
  const token = Deno.env.get("CF_TURN_API_TOKEN")
  if (!keyId || !token) throw new Error("CF_TURN_KEY_ID / CF_TURN_API_TOKEN are not set")

  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: CF_TTL_SECONDS }),
      signal: AbortSignal.timeout(5000),
    },
  )
  if (!res.ok) throw new Error(`Cloudflare API ${res.status}`)

  const body = (await res.json()) as { iceServers: RTCIceServer[] }
  // Port 53 is blocked by browsers (per Cloudflare docs) — drop it to avoid a useless timeout.
  return body.iceServers
    .map((s) => ({ ...s, urls: toArray(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length > 0)
}

function toArray(urls: string | string[]): string[] {
  return Array.isArray(urls) ? urls : [urls]
}
