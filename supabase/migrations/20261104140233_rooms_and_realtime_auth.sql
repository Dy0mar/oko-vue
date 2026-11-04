-- Meeting rooms (permanent, Meet-style codes) and authorization for their private
-- Realtime channels `room:<code>` used for call signaling and presence.

create table public.rooms (
  code        text primary key check (code ~ '^[a-z]{3}-[a-z]{4}-[a-z]{3}$'),
  title       text,
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- Any signed-in (whitelisted) user can open a room by its link.
create policy "authenticated reads rooms"
  on public.rooms for select
  to authenticated
  using (true);

create policy "admin creates rooms"
  on public.rooms for insert
  to authenticated
  with check ((select public.is_admin()) and created_by = (select auth.uid()));

create policy "admin updates rooms"
  on public.rooms for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "admin deletes rooms"
  on public.rooms for delete
  to authenticated
  using ((select public.is_admin()));

grant select, insert, update, delete on public.rooms to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime authorization for PRIVATE channels.
-- A signed-in user may listen/send broadcast and presence only on `room:<code>`
-- of an existing room. Public channels (e.g. the diagnostics probe) are not affected.
-- ---------------------------------------------------------------------------
create or replace function public.can_use_room_channel(topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select topic like 'room:%'
    and exists (select 1 from public.rooms r where r.code = substring(topic from 6))
$$;

revoke execute on function public.can_use_room_channel(text) from public, anon;
grant execute on function public.can_use_room_channel(text) to authenticated;

create policy "room members receive"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select public.can_use_room_channel(realtime.topic()))
  );

create policy "room members send"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select public.can_use_room_channel(realtime.topic()))
  );
