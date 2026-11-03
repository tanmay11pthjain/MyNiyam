-- Edit windows set by the pathshala's admin (Setup → Edit windows).
--   Niyam logs: sanghs.log_back_hours, now up to 7 days (168 hours). The app offers 0, 24, 48, 72 and 168:
--     today only, or 1, 2, 3 or 7 days back. Day D stays open until D ends plus this many hours.
--   Attendance: new sanghs.attendance_back_days, 0 to 30 (30 = how it worked before). Marks for a day
--     older than this can't be added, changed or cleared.
alter table public.sanghs drop constraint if exists sanghs_log_back_hours_check;
alter table public.sanghs add constraint sanghs_log_back_hours_check check (log_back_hours between 0 and 168);
alter table public.sanghs add column attendance_back_days int not null default 30 check (attendance_back_days between 0 and 30);
grant update (attendance_back_days) on public.sanghs to authenticated;

create or replace function private.check_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  back int;
begin
  select a.sangh_id, p.class_id into new.sangh_id, new.class_id
    from public.profiles p join public.accounts a on a.id = p.account_id
    where p.id = new.profile_id;
  select s.attendance_back_days into back from public.sanghs s where s.id = new.sangh_id;
  if new.day > private.local_today() or new.day < private.local_today() - coalesce(back, 30) then
    raise exception 'attendance day out of range' using errcode = 'check_violation', hint = 'day_out_of_range';
  end if;
  if tg_op = 'UPDATE' and old.day < private.local_today() - coalesce(back, 30) then
    raise exception 'attendance day out of range' using errcode = 'check_violation', hint = 'day_out_of_range';
  end if;
  return new;
end $$;

-- Clearing a day is held to the same window. Deletes caused by removing a person still go through
-- (the person's row is already gone by the time the cascade reaches attendance).
create function private.check_attendance_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  back int;
begin
  if not exists (select 1 from public.profiles where id = old.profile_id) then return old; end if;
  select s.attendance_back_days into back from public.sanghs s where s.id = old.sangh_id;
  if back is null then return old; end if;
  if old.day < private.local_today() - back then
    raise exception 'attendance day out of range' using errcode = 'P0001', hint = 'day_out_of_range';
  end if;
  return old;
end $$;
create trigger attendance_window_delete before delete on public.attendance
  for each row execute function private.check_attendance_delete();
