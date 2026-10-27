-- P3: personal vows, badges and the Sangh feed (Anumodana), pathshala goals and challenges,
-- a class leaderboard (off unless an admin turns it on), streak repair and reminders.
--
-- Members only ever see other members through the security definer functions at the end, which
-- stay inside the caller's own sangh and show a short name ("Riya S."), never a number or a photo.

-- ---------------------------------------------------------------------------
-- Choices a member makes, and the admin's leaderboard switch per class
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column share_milestones boolean not null default true,   -- my milestones appear in the Sangh feed
  add column board_initials   boolean not null default false;  -- the leaderboard shows only my initials
grant update (share_milestones, board_initials) on public.profiles to authenticated;

alter table public.classes add column leaderboard boolean not null default false;
grant update (leaderboard) on public.classes to authenticated;

-- "Riya Shah" → "Riya S."; "Riya" → "Riya". Initials: "R. S."
create function private.short_name(n text) returns text
language sql immutable set search_path = '' as $$
  select case when cardinality(w) > 1 then w[1] || ' ' || upper(left(w[cardinality(w)], 1)) || '.' else w[1] end
  from (select regexp_split_to_array(btrim(n), '\s+') as w) x
$$;
create function private.initials(n text) returns text
language sql immutable set search_path = '' as $$
  select upper(left(w[1], 1)) || '.' || case when cardinality(w) > 1 then ' ' || upper(left(w[cardinality(w)], 1)) || '.' else '' end
  from (select regexp_split_to_array(btrim(n), '\s+') as w) x
$$;

-- Is this person on the signed-in number?
create function private.own_profile(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = pid and account_id = private.current_account_id() and removed_at is null)
$$;
grant execute on function private.own_profile(uuid), private.short_name(text), private.initials(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Personal vows (pachchakkhan): private, with an end date. At most 5 running per person.
-- ---------------------------------------------------------------------------
create table public.vows (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 60),
  start_date date not null default private.local_today(),
  end_date   date not null,
  ended_at   timestamptz,                               -- ended early by the member
  created_at timestamptz not null default now(),
  constraint vows_dates check (end_date >= start_date and end_date - start_date <= 366)
);
create index vows_profile on public.vows (profile_id, end_date);

create function private.check_vow() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.profiles where id = new.profile_id for update; -- one add at a time per person
  if (select count(*) from public.vows where profile_id = new.profile_id and ended_at is null
      and end_date >= private.local_today()) >= 5 then
    raise exception 'too many vows' using errcode = 'P0001', hint = 'vow_limit';
  end if;
  return new;
end $$;
create trigger vows_limit before insert on public.vows for each row execute function private.check_vow();

-- A vow is ticked for today or yesterday, only while it runs.
create table public.vow_logs (
  vow_id   uuid not null references public.vows(id) on delete cascade,
  log_date date not null,
  primary key (vow_id, log_date)
);
create function private.check_vow_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.vows v where v.id = new.vow_id and v.ended_at is null
      and new.log_date between greatest(v.start_date, private.local_today() - 1) and least(v.end_date, private.local_today())) then
    raise exception 'this day can no longer be ticked' using errcode = 'P0001', hint = 'log_window_closed';
  end if;
  return new;
end $$;
create trigger vow_logs_window before insert on public.vow_logs for each row execute function private.check_vow_log();

alter table public.vows     enable row level security;
alter table public.vow_logs enable row level security;
create policy vows_own on public.vows for all to authenticated
  using (private.own_profile(profile_id)) with check (private.own_profile(profile_id));
create policy vow_logs_own on public.vow_logs for all to authenticated
  using (exists (select 1 from public.vows v where v.id = vow_id and private.own_profile(v.profile_id)))
  with check (exists (select 1 from public.vows v where v.id = vow_id and private.own_profile(v.profile_id)));
grant select, insert, delete on public.vows, public.vow_logs to authenticated;
grant update (ended_at) on public.vows to authenticated;

-- ---------------------------------------------------------------------------
-- Badges. The server awards them (see src/lib/badges.ts); each is earned once.
-- ---------------------------------------------------------------------------
create table public.badges_earned (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sangh_id   uuid not null references public.sanghs(id) on delete cascade,
  badge      text not null check (badge ~ '^[a-z0-9_:-]{1,60}$'),
  earned_at  timestamptz not null default now(),
  unique (profile_id, badge)
);
create index badges_sangh_recent on public.badges_earned (sangh_id, earned_at desc);

create function private.set_badge_sangh() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.sangh_id := private.profile_sangh(new.profile_id);
  return new;
end $$;
create trigger badges_sangh before insert on public.badges_earned for each row execute function private.set_badge_sangh();

-- Anumodana: one per person per milestone, with a preset message (no free text).
create table public.anumodana (
  badge_id     bigint not null references public.badges_earned(id) on delete cascade,
  from_profile uuid not null references public.profiles(id) on delete cascade,
  msg          smallint not null default 0 check (msg between 0 and 3),
  at           timestamptz not null default now(),
  primary key (badge_id, from_profile)
);
create index anumodana_from on public.anumodana (from_profile);

-- The sangh a milestone belongs to (members can't read other people's badge rows directly).
create function private.badge_sangh(bid bigint) returns uuid
language sql stable security definer set search_path = '' as $$
  select sangh_id from public.badges_earned where id = bid
$$;
grant execute on function private.badge_sangh(bigint) to authenticated;

alter table public.badges_earned enable row level security;
alter table public.anumodana     enable row level security;
create policy badges_own on public.badges_earned for all to authenticated
  using (private.own_profile(profile_id)) with check (private.own_profile(profile_id));
create policy badges_staff_read on public.badges_earned for select to authenticated
  using (private.has_perm(sangh_id, 'view_members'));
create policy anumodana_own on public.anumodana for all to authenticated
  using (private.own_profile(from_profile))
  with check (private.own_profile(from_profile) and private.badge_sangh(badge_id) = private.current_sangh_id());
grant select, insert (profile_id, badge) on public.badges_earned to authenticated;
grant usage on sequence public.badges_earned_id_seq to authenticated;
grant select, insert, update (msg, at), delete on public.anumodana to authenticated;

-- ---------------------------------------------------------------------------
-- Goals: a pathshala-wide total ("10 lakh Navkar") or a challenge each person completes
-- ("Navkarsi on 21 days"), for one niyam between two dates.
-- ---------------------------------------------------------------------------
create table public.sangh_goals (
  id          uuid primary key default gen_random_uuid(),
  sangh_id    uuid not null references public.sanghs(id) on delete cascade,
  kind        text not null check (kind in ('total', 'challenge')),
  title       text not null check (length(btrim(title)) between 2 and 80),
  title_hi    text check (length(title_hi) <= 80),
  niyam_id    uuid not null references public.niyams(id) on delete cascade,
  target      int check (target between 1 and 100000000),
  days        int check (days between 1 and 367),
  start_date  date not null,
  end_date    date not null,
  all_classes boolean not null default true,
  class_ids   uuid[] not null default '{}',
  created_by  text,
  created_at  timestamptz not null default now(),
  constraint goals_dates check (end_date >= start_date and end_date - start_date <= 366),
  constraint goals_kind check ((kind = 'total' and target is not null)
    or (kind = 'challenge' and days is not null and days <= end_date - start_date + 1)),
  constraint goals_classes check (all_classes or cardinality(class_ids) >= 1)
);
create index sangh_goals_sangh on public.sangh_goals (sangh_id, end_date desc);
create index niyam_logs_niyam_date on public.niyam_logs (niyam_id, log_date);

create function private.check_goal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.niyams where id = new.niyam_id and sangh_id = new.sangh_id) then
    raise exception 'niyam is not in this sangh' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(new.class_ids) c
             where not exists (select 1 from public.classes where id = c and sangh_id = new.sangh_id)) then
    raise exception 'class does not belong to this sangh' using errcode = 'check_violation', hint = 'invalid_class';
  end if;
  return new;
end $$;
create trigger goals_same_sangh before insert or update on public.sangh_goals for each row execute function private.check_goal();

alter table public.sangh_goals enable row level security;
create policy goals_staff on public.sangh_goals for all to authenticated
  using (private.has_perm(sangh_id, 'niyams')) with check (private.has_perm(sangh_id, 'niyams'));
create policy goals_member_read on public.sangh_goals for select to authenticated
  using (sangh_id = private.current_sangh_id());
grant select, insert, update, delete on public.sangh_goals to authenticated;

-- A goal's total so far and how many people finished it (a challenge's days, or 1 log for a total).
create function public.goal_progress(goal uuid) returns table (total bigint, finishers int)
language sql stable security definer set search_path = '' as $$
  with g as (
    select g.* from public.sangh_goals g
    where g.id = goal and (g.sangh_id = private.current_sangh_id() or private.has_access(g.sangh_id))),
  l as (
    select l.profile_id, case when n.type in ('count', 'duration') then greatest(coalesce(l.value, 1), 1) else 1 end as amount
    from g join public.niyams n on n.id = g.niyam_id
    join public.niyam_logs l on l.niyam_id = g.niyam_id and l.done and l.log_date between g.start_date and g.end_date
    join public.profiles p on p.id = l.profile_id and p.removed_at is null
    where g.all_classes or p.class_id = any(g.class_ids))
  select coalesce((select sum(amount) from l), 0)::bigint,
    (select count(*)::int from (select profile_id from l group by profile_id
       having count(*) >= coalesce((select days from g), 1)) f)
  where exists (select 1 from g)
$$;
revoke execute on function public.goal_progress(uuid) from public, anon;
grant execute on function public.goal_progress(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Streak repair: a missed day bridged by an extra small niyam within 48 hours. One per 30 days;
-- the server checks the rules (src/lib/progress.ts repairOffer) before adding a row.
-- ---------------------------------------------------------------------------
create table public.streak_repairs (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  missed_date date not null,
  repaired_at timestamptz not null default now(),
  primary key (profile_id, missed_date)
);
alter table public.streak_repairs enable row level security;
create policy repairs_own on public.streak_repairs for all to authenticated
  using (private.own_profile(profile_id)) with check (private.own_profile(profile_id));
grant select, insert on public.streak_repairs to authenticated;

-- ---------------------------------------------------------------------------
-- Reminders: one web push subscription per phone (browser). Only the server touches this table.
-- ---------------------------------------------------------------------------
create table private.push_subs (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint       text not null unique check (length(endpoint) <= 1000 and endpoint like 'https://%'),
  p256dh         text not null check (length(p256dh) <= 200),
  auth           text not null check (length(auth) <= 100),
  remind_at      time not null default '20:00',   -- evening nudge, India time, only if nothing is logged
  chauvihar      boolean not null default false,  -- "Chauvihar in 30 minutes"
  last_evening   date,
  last_chauvihar date,
  fails          smallint not null default 0,
  created_at     timestamptz not null default now()
);
create index push_subs_account on private.push_subs (account_id);
alter table private.push_subs enable row level security;

-- ---------------------------------------------------------------------------
-- What members see of each other. Each function stays inside the caller's sangh.
-- ---------------------------------------------------------------------------

-- The last 7 days of milestones in my sangh, newest first, with Anumodana counts.
create function public.sangh_feed(viewer uuid)
returns table (id bigint, badge text, earned_at timestamptz, name text, mine boolean, count int, my_msg smallint)
language sql stable security definer set search_path = '' as $$
  select b.id, b.badge, b.earned_at, private.short_name(p.name), p.account_id = private.current_account_id(),
    (select count(*)::int from public.anumodana x where x.badge_id = b.id),
    (select x.msg from public.anumodana x where x.badge_id = b.id and x.from_profile = viewer)
  from public.badges_earned b
  join public.profiles p on p.id = b.profile_id and p.removed_at is null
  where private.own_profile(viewer)
    and b.sangh_id = private.current_sangh_id()
    and b.earned_at > now() - interval '7 days'
    and (p.share_milestones or p.account_id = private.current_account_id())
  order by b.earned_at desc
  limit 60
$$;

-- My class this week (Monday to today): days with at least one niyam kept. Empty unless the class has it on.
create function public.class_board(viewer uuid) returns table (rank int, name text, days int, me boolean)
language sql stable security definer set search_path = '' as $$
  with v as (
    select p.class_id from public.profiles p join public.classes c on c.id = p.class_id
    where p.id = viewer and private.own_profile(viewer) and c.leaderboard),
  wk as (select private.local_today() - (extract(isodow from private.local_today())::int - 1) as start),
  m as (
    select p.id, p.name, p.board_initials,
      (select count(distinct l.log_date) from public.niyam_logs l, wk
       where l.profile_id = p.id and l.done and l.log_date between wk.start and private.local_today())::int as days
    from v join public.profiles p on p.class_id = v.class_id and p.removed_at is null
    join public.accounts a on a.id = p.account_id and a.removed_at is null)
  select (rank() over (order by days desc))::int,
    case when board_initials then private.initials(name) else private.short_name(name) end, days, id = viewer
  from m order by days desc, name
$$;

revoke execute on function public.sangh_feed(uuid), public.class_board(uuid) from public, anon;
grant execute on function public.sangh_feed(uuid), public.class_board(uuid) to authenticated;

-- Old repairs and dead subscriptions go in the daily cleanup.
create or replace function private.sweep() returns void
language sql security definer set search_path = '' as $$
  delete from private.otp_codes      where expires_at < now() - interval '1 hour';
  delete from private.otp_sends      where sent_at    < now() - interval '1 day';
  delete from private.rate_limits    where window_start < now() - interval '1 day';
  delete from public.accounts        where removed_at < now() - interval '30 days';
  delete from public.profiles        where removed_at < now() - interval '30 days';
  delete from private.admin_sessions where last_used_at < now() - interval '30 days';
  delete from public.activity_log    where at < now() - interval '1 year';
  delete from public.streak_repairs  where repaired_at < now() - interval '1 year';
  delete from private.push_subs      where fails >= 5;
$$;
