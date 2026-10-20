-- MyNiyam admin panel (P1): sangh admins and the super admin, sangh profile and join settings,
-- classes, the join form, niyams and their logs, and soft removal of families and profiles.
--
-- Who is who:
--   * The super admin (SUPER_ADMIN_PHONE, mirrored into private.super_admins at login) approves new
--     sanghs and assigns their admins.
--   * A sangh admin is a phone number in public.sangh_admins. That is separate from membership, so one
--     person can run several sanghs while their own number is a member of one sangh (or none).
--   * The app server runs admin queries as the `authenticated` role with the claim `admin_phone` set
--     (see asAdmin in src/server/db.ts). The policies below are what keep each sangh's data apart.

-- ---------------------------------------------------------------------------
-- Sangh profile and join settings
-- ---------------------------------------------------------------------------
alter table public.sanghs
  add column name_hi        text check (length(name_hi) <= 120),
  add column area           text check (length(area) <= 80),
  add column sampraday      text check (length(sampraday) <= 80),
  add column contact_phone  text check (contact_phone ~ '^\+91[6-9][0-9]{9}$'),
  add column about          text check (length(about) <= 200),
  add column status         text not null default 'active' check (status in ('pending', 'active')),
  add column join_open      boolean not null default true,   -- off: nobody new can join; members are unaffected
  add column searchable     boolean not null default true,   -- off: joinable by code or QR only
  -- How far back a member may log a niyam: up to this many hours after the day ends (0 = today only).
  add column log_back_hours int not null default 24 check (log_back_hours between 0 and 24),
  add column form_updated_at timestamptz,                    -- setup checklist: "build the join form"
  add column code_shared_at  timestamptz,                    -- setup checklist: "share the code"
  add column requested_by   text,                            -- phone that asked for this sangh
  add column approved_at    timestamptz;

-- The class question used to be built in. It is now a field in the form like the others, so every
-- existing sangh gets it first, required, exactly as before.
update public.sanghs set form_fields =
  '[{"key": "class", "type": "class", "required": true, "label": {"en": "Class", "hi": "कक्षा"}}]'::jsonb || form_fields
where not form_fields @> '[{"type": "class"}]';
alter table public.sanghs alter column form_fields set default
  '[{"key": "class", "type": "class", "required": true, "label": {"en": "Class", "hi": "कक्षा"}}]'::jsonb;

-- ---------------------------------------------------------------------------
-- Classes: hidden from new joins, age hint, and no deleting a class that has members
-- ---------------------------------------------------------------------------
alter table public.classes
  add column hidden  boolean not null default false,
  add column age_min int check (age_min between 0 and 120),
  add column age_max int check (age_max between 0 and 120),
  add constraint classes_age_range check (age_min is null or age_max is null or age_min <= age_max);

-- ---------------------------------------------------------------------------
-- Soft removal. Removing a family moves its number to removed_phone, which frees it at once for
-- another sangh; the family and its logs stay hidden for 30 days, then private.sweep() deletes them.
-- ---------------------------------------------------------------------------
alter table public.accounts
  alter column phone drop not null,
  add column removed_at    timestamptz,
  add column removed_phone text,
  add constraint accounts_removed_shape check ((removed_at is null) = (phone is not null));
create index accounts_removed on public.accounts (removed_at) where removed_at is not null;

alter table public.profiles add column removed_at timestamptz;
drop index public.profiles_one_self;
create unique index profiles_one_self on public.profiles (account_id) where relation = 'self' and removed_at is null;
create index profiles_class on public.profiles (class_id) where removed_at is null;

create or replace function private.check_profile_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.accounts where id = new.account_id for update; -- serialise concurrent adds
  if (select count(*) from public.profiles where account_id = new.account_id and removed_at is null) >= 8 then
    raise exception 'too many profiles on this number' using errcode = 'P0001', hint = 'profile_limit';
  end if;
  return new;
end $$;

create or replace function private.current_sangh_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select sangh_id from public.accounts where id = private.current_account_id() and removed_at is null
$$;

create function private.check_class_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles where class_id = old.id and removed_at is null) then
    raise exception 'this class still has members' using errcode = 'P0001', hint = 'class_has_members';
  end if;
  return old;
end $$;
create trigger classes_no_delete_with_members before delete on public.classes
  for each row execute function private.check_class_delete();

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------
create table public.sangh_admins (
  sangh_id uuid not null references public.sanghs(id) on delete cascade,
  phone    text not null check (phone ~ '^\+91[6-9][0-9]{9}$'),
  added_by text,
  added_at timestamptz not null default now(),
  primary key (sangh_id, phone)
);
create index sangh_admins_phone on public.sangh_admins (phone);

-- Mirrors SUPER_ADMIN_PHONE. The server keeps it in step at every admin login.
create table private.super_admins (phone text primary key);

-- Server-side admin sessions, so "ends after 30 days unused" and log-out are exact.
create table private.admin_sessions (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null,
  active_sangh_id uuid references public.sanghs(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz not null default now()
);
create index admin_sessions_phone on private.admin_sessions (phone);

alter table public.sangh_admins     enable row level security;
alter table private.super_admins    enable row level security;
alter table private.admin_sessions  enable row level security;

create function private.current_admin_phone() returns text
language sql stable set search_path = '' as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'admin_phone', '')
$$;

create function private.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.super_admins where phone = private.current_admin_phone())
$$;

create function private.is_sangh_admin(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sangh_admins where sangh_id = target and phone = private.current_admin_phone())
$$;

-- ---------------------------------------------------------------------------
-- Niyams and logs
-- ---------------------------------------------------------------------------
create table public.niyams (
  id           uuid primary key default gen_random_uuid(),
  sangh_id     uuid not null references public.sanghs(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 60),
  name_hi      text check (length(name_hi) <= 60),
  type         text not null check (type in ('yesno', 'count', 'duration', 'choice')),
  target       int check (target between 1 and 100000),        -- count: how many; duration: minutes
  options      jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'), -- choice: [{value, en, hi}]
  icon         text check (length(icon) <= 24),
  note         text check (length(note) <= 200),
  all_classes  boolean not null default true,
  schedule     text not null default 'daily' check (schedule in ('daily', 'weekdays', 'range')),
  weekdays     int[] check (weekdays <@ array[0,1,2,3,4,5,6]),  -- 0 = Sunday
  start_date   date,
  end_date     date,
  is_core      boolean not null default true,                   -- progress counts core niyams only
  sort_order   int not null default 0,
  status       text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at   timestamptz not null default now(),
  constraint niyams_target check (type not in ('count', 'duration') or target is not null),
  constraint niyams_choice check (type <> 'choice' or jsonb_array_length(options) between 2 and 12),
  constraint niyams_weekdays check (schedule <> 'weekdays' or cardinality(weekdays) >= 1),
  constraint niyams_range check (schedule <> 'range' or (start_date is not null and end_date is not null and start_date <= end_date))
);
create index niyams_sangh on public.niyams (sangh_id, sort_order);

create table public.niyam_classes (
  niyam_id uuid not null references public.niyams(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  primary key (niyam_id, class_id)
);
create index niyam_classes_class on public.niyam_classes (class_id);

create function private.check_niyam_class() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.niyams n join public.classes c on c.sangh_id = n.sangh_id
    where n.id = new.niyam_id and c.id = new.class_id
  ) then
    raise exception 'class does not belong to this sangh' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger niyam_classes_same_sangh before insert or update on public.niyam_classes
  for each row execute function private.check_niyam_class();

-- One row per person, niyam and day. `value` is the count or the minutes; `choice` the option picked.
create table public.niyam_logs (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  niyam_id   uuid not null references public.niyams(id) on delete cascade,
  log_date   date not null,
  done       boolean not null default true,
  value      int check (value between 0 and 100000),
  choice     text check (length(choice) <= 40),
  logged_at  timestamptz not null default now(),
  unique (profile_id, niyam_id, log_date)
);
create index niyam_logs_date on public.niyam_logs (log_date, profile_id);
create index niyam_logs_profile on public.niyam_logs (profile_id, log_date desc);

-- Days are Indian days. A log for day D is accepted until D ends plus the sangh's log_back_hours
-- (24 by default: yesterday can still be filled in today), never for a day that hasn't started.
create function private.local_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create function private.check_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  back int;
  local_now timestamp := now() at time zone 'Asia/Kolkata';
begin
  select s.log_back_hours into back
  from public.profiles p
  join public.accounts a on a.id = p.account_id
  join public.niyams n on n.sangh_id = a.sangh_id and n.id = new.niyam_id
  join public.sanghs s on s.id = a.sangh_id
  where p.id = new.profile_id and p.removed_at is null and a.removed_at is null;
  if back is null then
    raise exception 'niyam is not in this sangh' using errcode = 'check_violation';
  end if;
  if new.log_date > local_now::date then
    raise exception 'cannot log a day that has not started' using errcode = 'P0001', hint = 'log_window_closed';
  end if;
  if local_now >= (new.log_date + 1)::timestamp + make_interval(hours => back) then
    raise exception 'this day can no longer be logged' using errcode = 'P0001', hint = 'log_window_closed';
  end if;
  new.logged_at := now();
  return new;
end $$;
create trigger niyam_logs_window before insert or update on public.niyam_logs
  for each row execute function private.check_log();

alter table public.niyams        enable row level security;
alter table public.niyam_classes enable row level security;
alter table public.niyam_logs    enable row level security;

-- ---------------------------------------------------------------------------
-- Policies: admins see and change only the sanghs in sangh_admins for their phone.
-- Removed families and profiles are invisible to everyone.
-- ---------------------------------------------------------------------------
create policy sangh_admin_read on public.sanghs for select to authenticated
  using (private.is_sangh_admin(id) or private.is_super_admin());
create policy sangh_admin_update on public.sanghs for update to authenticated
  using (private.is_sangh_admin(id)) with check (private.is_sangh_admin(id));

create policy classes_admin on public.classes for all to authenticated
  using (private.is_sangh_admin(sangh_id)) with check (private.is_sangh_admin(sangh_id));

create policy accounts_admin_read on public.accounts for select to authenticated
  using (removed_at is null and private.is_sangh_admin(sangh_id));

drop policy profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using (account_id = private.current_account_id() and removed_at is null)
  with check (account_id = private.current_account_id() and removed_at is null);
create policy profiles_sangh_admin on public.profiles for select to authenticated
  using (removed_at is null and exists (
    select 1 from public.accounts a where a.id = profiles.account_id and a.removed_at is null and private.is_sangh_admin(a.sangh_id)));
create policy profiles_sangh_admin_update on public.profiles for update to authenticated
  using (removed_at is null and exists (
    select 1 from public.accounts a where a.id = profiles.account_id and a.removed_at is null and private.is_sangh_admin(a.sangh_id)))
  with check (removed_at is null);

create policy answers_sangh_admin on public.profile_answers for select to authenticated
  using (exists (
    select 1 from public.profiles p join public.accounts a on a.id = p.account_id
    where p.id = profile_id and p.removed_at is null and a.removed_at is null and private.is_sangh_admin(a.sangh_id)));

create policy niyams_admin on public.niyams for all to authenticated
  using (private.is_sangh_admin(sangh_id)) with check (private.is_sangh_admin(sangh_id));
create policy niyams_member_read on public.niyams for select to authenticated
  using (sangh_id = private.current_sangh_id() and status <> 'archived');

create policy niyam_classes_admin on public.niyam_classes for all to authenticated
  using (exists (select 1 from public.niyams n where n.id = niyam_id and private.is_sangh_admin(n.sangh_id)))
  with check (exists (select 1 from public.niyams n where n.id = niyam_id and private.is_sangh_admin(n.sangh_id)));
create policy niyam_classes_member_read on public.niyam_classes for select to authenticated
  using (exists (select 1 from public.niyams n where n.id = niyam_id and n.sangh_id = private.current_sangh_id()));

create policy logs_own on public.niyam_logs for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.account_id = private.current_account_id() and p.removed_at is null))
  with check (exists (select 1 from public.profiles p where p.id = profile_id and p.account_id = private.current_account_id() and p.removed_at is null));
create policy logs_sangh_admin on public.niyam_logs for select to authenticated
  using (exists (select 1 from public.niyams n where n.id = niyam_id and private.is_sangh_admin(n.sangh_id)));

create policy sangh_admins_read on public.sangh_admins for select to authenticated
  using (phone = private.current_admin_phone() or private.is_sangh_admin(sangh_id) or private.is_super_admin());

-- Grants. Columns not granted cannot be written at all, whatever the policies say.
revoke all on public.sangh_admins, public.niyams, public.niyam_classes, public.niyam_logs from anon, authenticated;
grant execute on function private.current_admin_phone(), private.is_super_admin(), private.is_sangh_admin(uuid), private.local_today() to authenticated;
grant update (name, name_hi, city, area, sampraday, contact_phone, about, logo_url, join_open, searchable,
              log_back_hours, form_fields, form_updated_at, code_shared_at) on public.sanghs to authenticated;
grant insert (sangh_id, name, name_hi, sort_order, hidden, age_min, age_max), update (name, name_hi, sort_order, hidden, age_min, age_max), delete
  on public.classes to authenticated;
grant update (photo_url) on public.profiles to authenticated;
grant select on public.sangh_admins to authenticated;
grant select, insert, update, delete on public.niyams, public.niyam_classes to authenticated;
grant select, insert, update, delete on public.niyam_logs to authenticated;

-- ---------------------------------------------------------------------------
-- Functions for the actions that need more than a row's own policy
-- ---------------------------------------------------------------------------

-- A new join code for the sangh. The old one stops working at once (the column holds only one).
create function public.admin_set_join_code(target uuid, new_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_sangh_admin(target) then
    raise exception 'not an admin of this sangh' using errcode = '42501';
  end if;
  update public.sanghs set join_code = new_code, code_shared_at = null where id = target;
end $$;

-- Remove a family: frees the number now, hides everything, deletes it after 30 days.
create function public.admin_remove_family(target uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  select sangh_id into s from public.accounts where id = target and removed_at is null for update;
  if s is null then return false; end if;
  if not private.is_sangh_admin(s) then
    raise exception 'not an admin of this sangh' using errcode = '42501';
  end if;
  update public.accounts set removed_at = now(), removed_phone = phone, phone = null where id = target;
  return true;
end $$;

-- Remove one person; the rest of the family stays.
create function public.admin_remove_profile(target uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  select a.sangh_id into s from public.profiles p join public.accounts a on a.id = p.account_id
  where p.id = target and p.removed_at is null and a.removed_at is null for update of p;
  if s is null then return false; end if;
  if not private.is_sangh_admin(s) then
    raise exception 'not an admin of this sangh' using errcode = '42501';
  end if;
  update public.profiles set removed_at = now() where id = target;
  return true;
end $$;

-- The older member-admin removal now removes the same soft way.
create or replace function public.admin_remove_account(target_phone text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if not private.current_is_admin() then
    raise exception 'only a sangh admin can remove a number' using errcode = '42501';
  end if;
  select id into target from public.accounts
    where phone = target_phone and sangh_id = private.current_sangh_id() and removed_at is null
    for update;
  if target is null then return false; end if;
  if target = private.current_account_id() then
    raise exception 'an admin cannot remove their own number' using errcode = 'P0001';
  end if;
  update public.accounts set removed_at = now(), removed_phone = phone, phone = null where id = target;
  return true;
end $$;

-- Anyone signed in as an admin can ask for a new sangh. It stays pending (not findable, not
-- joinable) until the super admin approves it. At most 3 pending requests per phone.
create function public.request_sangh(p_name text, p_city text, p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me text := private.current_admin_phone(); s uuid;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('request_sangh:' || me));
  if (select count(*) from public.sanghs where requested_by = me and status = 'pending') >= 3 then
    raise exception 'too many pending requests' using errcode = 'P0001', hint = 'too_many_requests';
  end if;
  insert into public.sanghs (name, city, join_code, status, requested_by)
  values (p_name, p_city, p_code, 'pending', me) returning id into s;
  insert into public.sangh_admins (sangh_id, phone, added_by) values (s, me, me);
  return s;
end $$;

-- Super admin: create a sangh straight away, with its first admin.
create function public.super_create_sangh(p_name text, p_city text, p_code text, p_admin text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  if not private.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  insert into public.sanghs (name, city, join_code, status, approved_at, requested_by)
  values (p_name, p_city, p_code, 'active', now(), private.current_admin_phone()) returning id into s;
  if p_admin is not null then
    insert into public.sangh_admins (sangh_id, phone, added_by) values (s, p_admin, private.current_admin_phone());
  end if;
  return s;
end $$;

create function public.super_approve_sangh(target uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  update public.sanghs set status = 'active', approved_at = now() where id = target and status = 'pending';
  return found;
end $$;

-- Super admin turns down a request. Only a pending sangh can be deleted, and it has no members.
create function public.super_reject_sangh(target uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  delete from public.sanghs where id = target and status = 'pending';
  return found;
end $$;

create function public.super_set_admin(target uuid, admin_phone text, make_admin boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  if make_admin then
    insert into public.sangh_admins (sangh_id, phone, added_by) values (target, admin_phone, private.current_admin_phone())
    on conflict do nothing;
  else
    delete from public.sangh_admins where sangh_id = target and phone = admin_phone;
  end if;
end $$;

revoke execute on function public.admin_set_join_code(uuid, text), public.admin_remove_family(uuid), public.admin_remove_profile(uuid),
  public.request_sangh(text, text, text), public.super_create_sangh(text, text, text, text), public.super_approve_sangh(uuid),
  public.super_reject_sangh(uuid), public.super_set_admin(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_join_code(uuid, text), public.admin_remove_family(uuid), public.admin_remove_profile(uuid),
  public.request_sangh(text, text, text), public.super_create_sangh(text, text, text, text), public.super_approve_sangh(uuid),
  public.super_reject_sangh(uuid), public.super_set_admin(uuid, text, boolean) to authenticated;

-- New members can only join an approved sangh whose joins are on.
create function private.check_join_open() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.sanghs where id = new.sangh_id and status = 'active' and join_open) then
    raise exception 'this sangh is not taking new members' using errcode = 'P0001', hint = 'joins_closed';
  end if;
  return new;
end $$;
create trigger accounts_join_open before insert on public.accounts
  for each row execute function private.check_join_open();

-- ---------------------------------------------------------------------------
-- Cleanup: removed families and profiles go after 30 days; idle admin sessions after 30 days.
-- ---------------------------------------------------------------------------
create or replace function private.sweep() returns void
language sql security definer set search_path = '' as $$
  delete from private.otp_codes      where expires_at < now() - interval '1 hour';
  delete from private.otp_sends      where sent_at    < now() - interval '1 day';
  delete from private.rate_limits    where window_start < now() - interval '1 day';
  delete from public.accounts        where removed_at < now() - interval '30 days';
  delete from public.profiles        where removed_at < now() - interval '30 days';
  delete from private.admin_sessions where last_used_at < now() - interval '30 days';
$$;
