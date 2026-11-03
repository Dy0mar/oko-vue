-- ICE servers (STUN/TURN) managed by the admin, and diagnostics reports from users.

-- Admin = app_metadata.role in the JWT. Users cannot edit app_metadata themselves.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

-- ---------------------------------------------------------------------------
-- ice_servers
--   kind = 'static'     → urls / username / credential are stored here
--   kind = 'cloudflare' → credentials are generated on every request by the
--                         `ice-servers` edge function (CF_TURN_KEY_ID / CF_TURN_API_TOKEN secrets)
-- Only the admin can read or change this table. Clients get a ready config
-- from the edge function, never from the table.
-- ---------------------------------------------------------------------------
create table public.ice_servers (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  kind        text not null default 'static' check (kind in ('static', 'cloudflare')),
  urls        text[] not null default '{}',
  username    text,
  credential  text,
  enabled     boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint static_has_urls check (kind <> 'static' or cardinality(urls) > 0)
);

alter table public.ice_servers enable row level security;

create policy "admin manages ice servers"
  on public.ice_servers for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.ice_servers to authenticated;

insert into public.ice_servers (label, kind, urls, sort, enabled) values
  ('Google STUN',              'static',     '{stun:stun.l.google.com:19302}',    10, true),
  ('Google STUN #2',           'static',     '{stun:stun1.l.google.com:19302}',   20, true),
  ('Cloudflare STUN',          'static',     '{stun:stun.cloudflare.com:3478}',   30, true),
  ('Twilio STUN',              'static',     '{stun:global.stun.twilio.com:3478}', 40, true),
  ('Metered STUN (порт 80)',   'static',     '{stun:stun.relay.metered.ca:80}',   50, true),
  ('Nextcloud STUN (порт 443)', 'static',    '{stun:stun.nextcloud.com:443}',     60, true),
  -- Disabled by default: enable in the admin UI after setting CF_TURN_KEY_ID / CF_TURN_API_TOKEN secrets.
  ('Cloudflare TURN',          'cloudflare', '{}',                                100, false);

-- ---------------------------------------------------------------------------
-- diag_reports: any signed-in user writes their own report, only the admin reads.
-- ---------------------------------------------------------------------------
create table public.diag_reports (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  report      jsonb not null,
  created_at  timestamptz not null default now()
);

create index diag_reports_created_at_idx on public.diag_reports (created_at desc);

alter table public.diag_reports enable row level security;

create policy "user inserts own report"
  on public.diag_reports for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "admin reads reports"
  on public.diag_reports for select
  to authenticated
  using ((select public.is_admin()));

grant select, insert on public.diag_reports to authenticated;
