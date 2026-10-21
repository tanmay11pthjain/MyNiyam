-- Clearing a log is held to the same window as writing one: a member can undo yesterday's niyam,
-- but not empty a day that has closed. Deletes caused by removing a person or a niyam still go through
-- (the parent row is already gone by the time the cascade reaches the log).
create function private.check_log_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  back int;
  local_now timestamp := now() at time zone 'Asia/Kolkata';
begin
  select s.log_back_hours into back
  from public.profiles p
  join public.accounts a on a.id = p.account_id
  join public.niyams n on n.sangh_id = a.sangh_id and n.id = old.niyam_id
  join public.sanghs s on s.id = a.sangh_id
  where p.id = old.profile_id;
  if back is null then return old; end if; -- profile, niyam or sangh already deleted: a cascade
  if local_now >= (old.log_date + 1)::timestamp + make_interval(hours => back) then
    raise exception 'this day can no longer be changed' using errcode = 'P0001', hint = 'log_window_closed';
  end if;
  return old;
end $$;

create trigger niyam_logs_window_delete before delete on public.niyam_logs
  for each row execute function private.check_log_delete();
