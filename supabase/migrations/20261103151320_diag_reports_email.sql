-- Show who sent a report: auth.users is not readable from the client (and must not be),
-- so the author's email is copied from their JWT at insert time.
alter table public.diag_reports
  add column user_email text default (auth.jwt() ->> 'email');

-- The email must be the caller's own — it cannot be spoofed via an explicit value.
drop policy "user inserts own report" on public.diag_reports;
create policy "user inserts own report"
  on public.diag_reports for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and user_email is not distinct from (select auth.jwt() ->> 'email')
  );

create policy "admin deletes reports"
  on public.diag_reports for delete
  to authenticated
  using ((select public.is_admin()));

grant delete on public.diag_reports to authenticated;
