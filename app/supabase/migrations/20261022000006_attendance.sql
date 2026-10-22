-- Attendance: which days a class meets, who came (present, late or absent), and pathshala holidays.
-- Admins, and volunteers with "attendance" for their classes, take it. A member sees their own.

-- Days the class meets: 0 = Sunday ... 6 = Saturday. Empty = not set (any day can be taken).
alter table public.classes add column meets_on smallint[] not null default '{}'
  check (meets_on <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);

create table public.attendance (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  sangh_id   uuid not null references public.sanghs(id) on delete cascade,
  -- The class the person was in that day, so a later class change keeps old reports right.
  class_id   uuid references public.classes(id) on delete set null,
  status     text not null check (status in ('present', 'late', 'absent')),
  taken_by   text,
  taken_at   timestamptz not null default now(),
  primary key (profile_id, day)
);
create index attendance_class_day on public.attendance (class_id, day);
create index attendance_sangh_day on public.attendance (sangh_id, day);

-- Holidays (set by admins): no class that day, so it never counts against anyone.
create table public.sangh_holidays (
  sangh_id uuid not null references public.sanghs(id) on delete cascade,
  day      date not null,
  note     text check (length(note) <= 80),
  primary key (sangh_id, day)
);

-- The row's sangh and class always match the person; the day is never in the future or over 30 days back.
create function private.check_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select a.sangh_id, p.class_id into new.sangh_id, new.class_id
    from public.profiles p join public.accounts a on a.id = p.account_id
    where p.id = new.profile_id;
  if new.day > private.local_today() or new.day < private.local_today() - 30 then
    raise exception 'attendance day out of range' using errcode = 'check_violation', hint = 'day_out_of_range';
  end if;
  return new;
end $$;
create trigger attendance_fill before insert or update on public.attendance
  for each row execute function private.check_attendance();

alter table public.attendance enable row level security;
alter table public.sangh_holidays enable row level security;

create policy attendance_own_read on public.attendance for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.account_id = private.current_account_id()));
create policy attendance_staff on public.attendance for all to authenticated
  using (private.can_on_profile(profile_id, 'attendance'))
  with check (private.can_on_profile(profile_id, 'attendance'));

-- A teacher with only "attendance" sees the names of people in their classes (not their numbers).
create policy profiles_attendance_read on public.profiles for select to authenticated
  using (private.can_on_profile(id, 'attendance'));

create policy holidays_member_read on public.sangh_holidays for select to authenticated
  using (sangh_id = private.current_sangh_id() or private.has_access(sangh_id));
create policy holidays_staff on public.sangh_holidays for all to authenticated
  using (private.is_sangh_admin(sangh_id)) with check (private.is_sangh_admin(sangh_id));

revoke all on public.attendance, public.sangh_holidays from anon, authenticated;
grant select, insert, update, delete on public.attendance, public.sangh_holidays to authenticated;
grant insert (meets_on), update (meets_on) on public.classes to authenticated;
