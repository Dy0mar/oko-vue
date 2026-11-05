# OKO

[![CI](https://github.com/Dy0mar/oko-vue/actions/workflows/ci.yml/badge.svg)](https://github.com/Dy0mar/oko-vue/actions/workflows/ci.yml)

A small personal pet project: one-to-one (up to three people) video calls built on WebRTC with Vue 3 and Supabase.
It is meant to work across restrictive networks, where well-known services like Google Meet or Jitsi get throttled.

## ✨ Features

### 🔐 Email/password login with a whitelist (sign-ups disabled, users are created by the admin)

### 🩺 Network diagnostics: Supabase, every STUN/TURN URL, NAT type, camera and microphone. Reports are sent to the admin automatically

### 📞 Video calls: permanent rooms with Meet-style links (`/meet/abc-defg-hij`), mic/camera toggles, screen sharing, connection quality for both sides, stats panel (route, server, RTT, loss, bitrate)

### 🔗 Simple flow for the guest: open the link → sign in → automatic network check (progress ring) → Meet-style preview → "Join"

### ⚙️ Admin panel: rooms, STUN/TURN servers with per-URL tests, diagnostics reports; in a call — switch the media route to "TURN only"

## 🛠 Tech Stack

### Frontend

- [Vue 3](https://vuejs.org/)
- [PrimeVue 4](https://primevue.org/) (MIT; v5 moved to a commercial PrimeUI license)
- [Tailwind CSS 4](https://tailwindcss.com/) + [tailwindcss-primeui](https://github.com/primefaces/tailwindcss-primeui)
- [TypeScript](https://www.typescriptlang.org/)
- Native [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API): no wrapper libraries, the core is written by hand

### Backend

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime) for signaling
- Supabase Database (PostgreSQL + Row Level Security)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions) (Deno)

### Hosting

- [Vercel](https://vercel.com/) for the static SPA from `frontend/`

## 📁 Project Structure

```
.github/workflows/ci.yml       oxlint, eslint, prettier, vue-tsc, build
frontend/
  src/api/                     Supabase client and queries
  src/composables/useAuth.ts   session state, isAdmin, signIn/signOut
  src/composables/useNetworkCheck.ts  network check shared by /diag and /meet
  src/composables/call/        WebRTC core: signaling (Realtime), peer (perfect negotiation), media, stats
  src/router/                  routes + guard (requiresAuth / requiresAdmin / guestOnly)
  src/pages/                   Home, Login, Meet, Diag, Admin
  src/components/              AppHeader, ProgressRing, call/*, admin/*
  src/diagnostics/             ICE / HTTP / media probes
  vercel.json                  SPA rewrite + security headers
supabase/
  config.toml                  local stack (sign-ups disabled)
  migrations/                  schema, RLS, seeded STUN servers
  functions/ice-servers/       ICE servers for the signed-in user
```

Imports use the `src/...` alias (not `@/...`), so it is obvious they are not third-party.

## 🔒 Roles & Security

- The admin is `app_metadata.role = "admin"`. Users cannot change it themselves. The role gets into the JWT at sign-in, so **sign in again after changing it**.
- `isAdmin` on the frontend only hides UI. Real enforcement is RLS (`public.is_admin()`) plus JWT verification in the edge function.
- `ice_servers` is admin-only. Participants get a ready list from the `ice-servers` function.
- `diag_reports`: users insert their own report (email is taken from the JWT). Only the admin can read or delete reports.
- `rooms`: any signed-in user can open a room by its code; only the admin creates and deletes rooms.
- Call signaling runs on **private** Realtime channels `room:<code>`: RLS on `realtime.messages` lets only signed-in users in, and only for an existing room.
- `VITE_*` variables are shipped to the browser. Only put the URL and the **publishable** key there, never the secret / service_role key.

## 🚀 Local Development

Requirements: Node `^22.18` or `>=24.12`, pnpm 12 (`corepack enable`), Docker.
Run the Supabase CLI via `npx supabase …` from the **repo root**.

```bash
# 1. Frontend dependencies
cd frontend && pnpm install && cd ..

# 2. Local Supabase (Postgres, Auth, Realtime, Studio). Migrations are applied automatically.
npx supabase start
npx supabase status                # URLs and keys

# 3. Edge functions (separate process, keep it running)
npx supabase functions serve

# 4. Frontend env: frontend/.env.local (template: frontend/.env.example)
#    VITE_SUPABASE_URL=http://127.0.0.1:54321
#    VITE_SUPABASE_PUBLISHABLE_KEY=<Publishable key from `supabase status`>

# 5. Frontend
cd frontend && pnpm dev            # http://localhost:5173
```

Studio: http://127.0.0.1:54323

### Users & admin

1. Studio → Authentication → **Add user** (tick "Auto confirm").
2. Make yourself admin in the SQL Editor, then **sign in again**:

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'
where email = 'admin@example.com'
returning email, raw_app_meta_data;
```

Without `returning`, Studio shows "No rows returned". That does not mean the update failed.

### Frontend scripts (`frontend/`)

| Command | What it does |
|---|---|
| `pnpm dev` | dev server |
| `pnpm build` | type-check + production build |
| `pnpm lint` | oxlint + eslint **with autofix** |
| `pnpm format` | prettier (write) |
| `pnpm run check` | everything CI runs, no autofix: oxlint, eslint, prettier, vue-tsc, build |

`pnpm ci` is a built-in pnpm command (clean install), not our script. Use `pnpm run check`.

### Database migrations

```bash
npx supabase migration new <name>   # creates supabase/migrations/<timestamp>_<name>.sql
npx supabase migration up           # apply new migrations to the LOCAL db (data is kept)
npx supabase db reset               # ⚠️ recreates the local db from scratch: users and data are lost
```

Never edit a migration that is already applied in the cloud. Add a new one instead.

## 📦 Deployment

### Supabase (cloud project `oko`, ref `zvoqfyivpaqiqahwcjmh`)

Once per machine:

```bash
npx supabase login
npx supabase link --project-ref zvoqfyivpaqiqahwcjmh   # asks for the DB password (Dashboard → Project Settings → Database)
```

Ship changes:

```bash
npx supabase migration list --remote      # local vs cloud
npx supabase db push --remote --dry-run   # preview
npx supabase db push --remote             # apply migrations
npx supabase functions deploy ice-servers # deploy the edge function
```

- **In CLI 3, `db push` without `--remote` targets the LOCAL db.**
- When an agent (e.g. Claude Code) runs the CLI, production changes require `--yes`, and the agent should ask you first.
- **Do not run `npx supabase config push`.** It overwrites the cloud Auth settings with the local `config.toml`, including `site_url = localhost`.

Cloud Auth settings are set by hand in the Dashboard:

- Authentication → Sign In / Providers → **disable "Allow new users to sign up"**
- Authentication → URL Configuration → **Site URL** = your Vercel URL

Edge function secrets: only for TURN providers you enable (see [STUN / TURN](#-stun--turn)):

```bash
npx supabase secrets set METERED_APP_NAME=... METERED_API_KEY=...   # Metered Open Relay
npx supabase secrets set TURNIX_API_TOKEN=...                        # Turnix
npx supabase secrets set CF_TURN_KEY_ID=... CF_TURN_API_TOKEN=...    # Cloudflare
# locally: supabase/functions/.env (template: .env.example), then restart `functions serve`
```

`SUPABASE_URL` and the keys are injected into functions by the platform.

### Vercel

- **Root Directory:** `frontend` (Vite is detected automatically)
- **Environment Variables:**
  - `VITE_SUPABASE_URL` = `https://zvoqfyivpaqiqahwcjmh.supabase.co`
  - `VITE_SUPABASE_PUBLISHABLE_KEY` = Dashboard → Project Settings → API Keys → Publishable
- `VITE_*` values are baked into the bundle **at build time**, so **redeploy** after changing them.

## 🌐 STUN / TURN

Servers are managed in **`/admin` → STUN/TURN servers**:

- **Static:** URLs (`stun:`, `turn:`, `turns:`), plus username/credential for TURN.
- **Providers** (credentials are generated by the edge function on every request, provider keys stay in Supabase secrets). All are seeded **disabled** — set the secrets, then enable the row:

  | Provider | Secrets | Free tier (check current limits) |
  |---|---|---|
  | [Metered Open Relay](https://www.metered.ca/tools/openrelay/) | `METERED_APP_NAME` (the `<name>` of `<name>.metered.live`), `METERED_API_KEY` | 20 GB/month |
  | [Turnix](https://turnix.io/) | `TURNIX_API_TOKEN` | 10 GB/month |
  | [Cloudflare](https://developers.cloudflare.com/realtime/turn/) | `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` | needs a payment method |
- The ⚡ button tests every URL separately:
  - STUN works ⇔ a `srflx` candidate arrives.
  - TURN works ⇔ a `relay` candidate arrives in relay-only mode.

TURN over TLS on port 443 (`turns:…:443?transport=tcp`) matters most: on networks that throttle UDP/WebRTC media, it looks like regular HTTPS. WebRTC media itself is always encrypted (DTLS-SRTP), whatever the transport.

## 📞 How a call works

1. The admin creates a room in **`/admin` → Зустрічі** and sends the link `https://…/meet/abc-defg-hij`.
2. The guest opens it, signs in, and the page runs the network check automatically (unless this device already passed it for the current server list in the last 7 days). Result:
   - ✅ ready, ⚠️ may fail (STUN only and the NAT is symmetric, no TURN), ❌ cannot connect (no signaling or no working STUN/TURN at all).
3. **Preview** (like Google Meet): your camera, mic/camera toggles (join with them already off), a mic level meter and **who is already in the room** (presence is watched without announcing you). "Join" is an explicit click, which also keeps the remote audio from being blocked by autoplay rules. The preview camera continues into the call, no second permission prompt.
4. Peers find each other via Realtime presence and negotiate with MDN's *perfect negotiation* pattern. Media goes P2P when possible, otherwise via TURN.
5. Each side shows two quality badges per participant: how **you** receive them and how **they** receive you.

In a call the admin's ⚙️ picks the media route for everyone: **Auto**, **TURN only (any)** or **TURN only via a specific server** — handy to find out which provider gets through the guest's network. A switch rebuilds the connections (~1–2 s frozen video); 📊 shows the actual route and server.

The admin skips the check and gets the same preview. After signing in, the admin lands on the dashboard; the **OKO** logo always leads there.

## ✅ CI

`.github/workflows/ci.yml` runs on push and PR to `master`: `pnpm install --frozen-lockfile` → oxlint → eslint → prettier --check → vue-tsc → build. Run the same locally with `pnpm run check`.

## 🧯 Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Blank page | `VITE_SUPABASE_*` missing in `.env.local` / Vercel env, or a stale bundle (Ctrl+Shift+R) |
| `Function not found` locally | `npx supabase functions serve` is not running |
| `functions serve` died with `exit 137` | Docker killed the container (usually memory). Start it again |
| Admin page missing after a role change | Sign in again: the role in the JWT is refreshed at sign-in |
| `db push` says "Local database is up to date", cloud unchanged | You forgot `--remote` |
| Dark components on a light background | `darkModeSelector` must be `.app-dark`; the class is set on `<html>` in `index.html` |

## 🧠 Why I Built This

I wanted to learn WebRTC hands-on: signaling, ICE, NAT traversal and TURN, without hiding them behind a library.
And I needed a call app that actually works between two specific networks, one of which blocks the usual services.
