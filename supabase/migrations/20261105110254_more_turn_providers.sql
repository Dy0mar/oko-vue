-- More TURN providers with API-generated (short-lived) credentials, handled by the
-- `ice-servers` edge function like Cloudflare:
--   metered → secrets METERED_APP_NAME, METERED_API_KEY  (Open Relay, https://www.metered.ca/tools/openrelay/)
--   turnix  → secret  TURNIX_API_TOKEN                   (https://turnix.io/)
alter table public.ice_servers drop constraint ice_servers_kind_check;
alter table public.ice_servers
  add constraint ice_servers_kind_check check (kind in ('static', 'cloudflare', 'metered', 'turnix'));

-- Disabled until the secrets are set; enable in /admin.
insert into public.ice_servers (label, kind, sort, enabled) values
  ('Metered Open Relay', 'metered', 110, false),
  ('Turnix',             'turnix',  120, false);
