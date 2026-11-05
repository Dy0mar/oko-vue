// GET/POST /functions/v1/ice-servers → ICE servers for the signed-in user.
//
// Reads enabled rows from `ice_servers` (admin-only table, read here with the admin client).
// Static rows are returned as stored. Provider rows get short-lived TURN credentials from the
// provider's API on every request — provider keys never leave the server.
//
// Secrets (optional; a provider without its secrets is reported as an error for its row only):
//   cloudflare: CF_TURN_KEY_ID, CF_TURN_API_TOKEN
//   metered:    METERED_APP_NAME (the "<name>" of <name>.metered.live), METERED_API_KEY
//   turnix:     TURNIX_API_TOKEN
//   supabase secrets set NAME=value ...      (locally: supabase/functions/.env)

import "@supabase/functions-js/edge-runtime.d.ts"
import { withSupabase } from "@supabase/server"

type Kind = "static" | "cloudflare" | "metered" | "turnix"

interface IceServerRow {
  id: string
  label: string
  kind: Kind
  urls: string[]
  username: string | null
  credential: string | null
}

interface ServerEntry {
  id: string
  label: string
  kind: Kind
  iceServers: RTCIceServer[]
  /** Why the server is unavailable (e.g. provider secrets missing). */
  error?: string
}

/** Credentials lifetime. Must outlive the longest call. */
const TTL_SECONDS = 4 * 60 * 60
const PROVIDER_TIMEOUT_MS = 5000

type Provider = (req: Request) => Promise<RTCIceServer[]>

const PROVIDERS: Record<Exclude<Kind, "static">, Provider> = {
  cloudflare: cloudflareIceServers,
  metered: meteredIceServers,
  turnix: turnixIceServers,
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const { data, error } = await ctx.supabaseAdmin
      .from("ice_servers")
      .select("id, label, kind, urls, username, credential")
      .eq("enabled", true)
      .order("sort")

    if (error) {
      console.error("ice_servers select failed", error)
      return Response.json({ error: "failed to load ice servers" }, { status: 500 })
    }

    const servers = await Promise.all((data as IceServerRow[]).map((row) => toEntry(row, req)))
    return Response.json({ servers, ttl: TTL_SECONDS })
  }),
}

async function toEntry(row: IceServerRow, req: Request): Promise<ServerEntry> {
  const base = { id: row.id, label: row.label, kind: row.kind }
  if (row.kind === "static") {
    const server: RTCIceServer = { urls: row.urls }
    if (row.username) server.username = row.username
    if (row.credential) server.credential = row.credential
    return { ...base, iceServers: [server] }
  }
  try {
    return { ...base, iceServers: cleanUrls(await PROVIDERS[row.kind](req)) }
  } catch (e) {
    console.error(`${row.kind} turn failed`, e)
    return { ...base, iceServers: [], error: e instanceof Error ? e.message : String(e) }
  }
}

function secret(...names: string[]): string[] {
  const values = names.map((n) => Deno.env.get(n) ?? "")
  if (values.some((v) => !v)) throw new Error(`${names.join(" / ")} not set`)
  return values
}

async function json<T>(res: Response, provider: string): Promise<T> {
  if (!res.ok) throw new Error(`${provider} API ${res.status}`)
  return (await res.json()) as T
}

// https://developers.cloudflare.com/realtime/turn/generate-credentials/
async function cloudflareIceServers(): Promise<RTCIceServer[]> {
  const [keyId, token] = secret("CF_TURN_KEY_ID", "CF_TURN_API_TOKEN")
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    },
  )
  return (await json<{ iceServers: RTCIceServer[] }>(res, "Cloudflare")).iceServers
}

// https://www.metered.ca/tools/openrelay/ — returns the iceServers array itself.
async function meteredIceServers(): Promise<RTCIceServer[]> {
  const [app, apiKey] = secret("METERED_APP_NAME", "METERED_API_KEY")
  const url = `https://${encodeURIComponent(app)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  return await json<RTCIceServer[]>(res, "Metered")
}

// https://turnix.io/docs/api-reference/credentials
async function turnixIceServers(req: Request): Promise<RTCIceServer[]> {
  const [token] = secret("TURNIX_API_TOKEN")
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }
  // Lets Turnix pick the region nearest to the participant, not to the edge function.
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (clientIp) headers["X-TURN-CLIENT-IP"] = clientIp
  const res = await fetch("https://turnix.io/api/v1/credentials/ice", {
    method: "POST",
    headers,
    body: JSON.stringify({ ttl: TTL_SECONDS }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  })
  return (await json<{ iceServers: RTCIceServer[] }>(res, "Turnix")).iceServers
}

/** Port 53 is blocked by browsers (Cloudflare docs) — drop it to avoid a useless timeout. */
function cleanUrls(servers: RTCIceServer[]): RTCIceServer[] {
  return servers
    .map((s) => ({ ...s, urls: toArray(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length > 0)
}

function toArray(urls: string | string[]): string[] {
  return Array.isArray(urls) ? urls : [urls]
}
