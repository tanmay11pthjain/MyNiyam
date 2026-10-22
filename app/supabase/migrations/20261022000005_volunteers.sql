-- Volunteers and teachers: an admin hands parts of the work to other numbers without full control.
-- A volunteer signs in to the admin panel with their own number, like an admin. They see only the
-- classes they are given (none given = all classes) and can do only what is ticked for them.
-- Sangh details, the join code, volunteers and data requests stay with admins.
--
-- Permissions:
--   view_members   see members and their logs          announcements  post announcements
--   attendance     take attendance                     niyams         add and change niyams
--   setup          edit classes and the join form      remove_members remove members

create table public.sangh_volunteers (
  sangh_id  uuid not null references public.sanghs(id) on delete cascade,
  phone     text not null check (phone ~ '^\+91[6-9][0-9]{9}$'),
  name      text not null check (length(btrim(name)) between 1 and 60),
  class_ids uuid[] not null default '{}',
  perms     text[] not null default '{view_members,attendance}'
            check (perms <@ array['view_members', 'attendance', 'announcements', 'niyams', 'setup', 'remove_members']),
  added_by  text,
  added_at  timestamptz not null default now(),
  primary key (sangh_id, phone)
);
create index sangh_volunteers_phone on public.sangh_volunteers (phone);
alter table public.sangh_volunteers enable row level security;

-- ---------------------------------------------------------------------------
-- Who may do what. Admins may do everything in their sangh.
-- ---------------------------------------------------------------------------
create function private.has_access(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_sangh_admin(target) or exists (
    select 1 from public.sangh_volunteers where sangh_id = target and phone = private.current_admin_phone())
$$;

create function private.has_perm(target uuid, perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_sangh_admin(target) or exists (
    select 1 from public.sangh_volunteers where sangh_id = target and phone = private.current_admin_phone() and perm = any(perms))
$$;

-- A class this admin or volunteer may see. A person with no class is only for admins and all-class volunteers.
create function private.class_in_scope(target uuid, cls uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_sangh_admin(target) or exists (
    select 1 from public.sangh_volunteers where sangh_id = target and phone = private.current_admin_phone()
      and (cardinality(class_ids) = 0 or cls = any(class_ids)))
$$;

-- Can this admin or volunteer, with `perm`, act on this person?
create function private.can_on_profile(pid uuid, perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.accounts a on a.id = p.account_id
    where p.id = pid and p.removed_at is null and a.removed_at is null
      and private.has_perm(a.sangh_id, perm) and private.class_in_scope(a.sangh_id, p.class_id))
$$;

-- Can this admin or volunteer see this number (someone on it is in their classes)?
create function private.can_on_account(aid uuid, perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.accounts a join public.profiles p on p.account_id = a.id
    where a.id = aid and a.removed_at is null and p.removed_at is null
      and private.has_perm(a.sangh_id, perm) and private.class_in_scope(a.sangh_id, p.class_id))
$$;

-- Is this class one the current admin or volunteer may move a person on this number into?
create function private.class_ok_for(aid uuid, cls uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.accounts a where a.id = aid and private.class_in_scope(a.sangh_id, cls))
$$;

-- These run as their owner, so the policies below never read profiles and accounts through each other.
grant execute on function private.has_access(uuid), private.has_perm(uuid, text), private.class_in_scope(uuid, uuid),
  private.can_on_profile(uuid, text), private.can_on_account(uuid, text), private.class_ok_for(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Volunteer policies (added beside the admin ones; Postgres allows a row if any policy does).
-- ---------------------------------------------------------------------------
create policy volunteers_admin on public.sangh_volunteers for all to authenticated
  using (private.is_sangh_admin(sangh_id)) with check (private.is_sangh_admin(sangh_id));
create policy volunteers_self_read on public.sangh_volunteers for select to authenticated
  using (phone = private.current_admin_phone());

create policy sangh_volunteer_read on public.sanghs for select to authenticated using (private.has_access(id));

create policy classes_volunteer_read on public.classes for select to authenticated using (private.has_access(sangh_id));
create policy classes_volunteer_setup on public.classes for all to authenticated
  using (private.has_perm(sangh_id, 'setup')) with check (private.has_perm(sangh_id, 'setup'));

create policy accounts_volunteer_read on public.accounts for select to authenticated
  using (private.can_on_account(id, 'view_members'));

create policy profiles_volunteer_read on public.profiles for select to authenticated
  using (private.can_on_profile(id, 'view_members'));
create policy profiles_volunteer_setup on public.profiles for update to authenticated
  using (private.can_on_profile(id, 'setup'))
  with check (removed_at is null and private.class_ok_for(account_id, class_id));

create policy answers_volunteer_read on public.profile_answers for select to authenticated
  using (private.can_on_profile(profile_id, 'view_members'));

create policy logs_volunteer_read on public.niyam_logs for select to authenticated
  using (private.can_on_profile(profile_id, 'view_members'));

create policy niyams_volunteer_read on public.niyams for select to authenticated using (private.has_access(sangh_id));
create policy niyams_volunteer on public.niyams for all to authenticated
  using (private.has_perm(sangh_id, 'niyams')) with check (private.has_perm(sangh_id, 'niyams'));
create policy niyam_classes_volunteer on public.niyam_classes for all to authenticated
  using (exists (select 1 from public.niyams n where n.id = niyam_id and private.has_access(n.sangh_id)))
  with check (exists (select 1 from public.niyams n where n.id = niyam_id and private.has_perm(n.sangh_id, 'niyams')));

create policy announcements_volunteer on public.announcements for all to authenticated
  using (private.has_perm(sangh_id, 'announcements')) with check (private.has_perm(sangh_id, 'announcements'));
create policy announcement_classes_volunteer on public.announcement_classes for all to authenticated
  using (exists (select 1 from public.announcements an where an.id = announcement_id and private.has_perm(an.sangh_id, 'announcements')))
  with check (exists (select 1 from public.announcements an where an.id = announcement_id and private.has_perm(an.sangh_id, 'announcements')));
create policy announcement_views_volunteer_read on public.announcement_views for select to authenticated
  using (exists (select 1 from public.announcements an where an.id = announcement_id and private.has_perm(an.sangh_id, 'announcements')));

revoke all on public.sangh_volunteers from anon, authenticated;
grant select, insert, update, delete on public.sangh_volunteers to authenticated;

-- The join form is saved through a function, so a volunteer with "setup" can change it without being
-- able to change the sangh's other details.
create function public.save_join_form(target uuid, fields jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_perm(target, 'setup') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.sanghs set form_fields = fields, form_updated_at = now() where id = target;
  return found;
end $$;

-- Removing people: admins, or volunteers allowed to, within their classes.
create or replace function public.admin_remove_family(target uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  select sangh_id into s from public.accounts where id = target and removed_at is null for update;
  if s is null then return false; end if;
  if not private.has_perm(s, 'remove_members') or exists (
    select 1 from public.profiles p where p.account_id = target and p.removed_at is null and not private.class_in_scope(s, p.class_id)
  ) then
    raise exception 'not allowed to remove this family' using errcode = '42501';
  end if;
  update public.accounts set removed_at = now(), removed_phone = phone, phone = null where id = target;
  return true;
end $$;

create or replace function public.admin_remove_profile(target uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s uuid; c uuid;
begin
  select a.sangh_id, p.class_id into s, c from public.profiles p join public.accounts a on a.id = p.account_id
  where p.id = target and p.removed_at is null and a.removed_at is null for update of p;
  if s is null then return false; end if;
  if not (private.has_perm(s, 'remove_members') and private.class_in_scope(s, c)) then
    raise exception 'not allowed to remove this person' using errcode = '42501';
  end if;
  update public.profiles set removed_at = now() where id = target;
  return true;
end $$;

revoke execute on function public.save_join_form(uuid, jsonb) from public, anon;
grant execute on function public.save_join_form(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Activity log: who removed a member or changed a niyam, and when. Admins read it.
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id       bigint generated always as identity primary key,
  sangh_id uuid not null references public.sanghs(id) on delete cascade,
  actor    text not null,
  action   text not null check (length(action) <= 40),
  detail   text check (length(detail) <= 200),
  at       timestamptz not null default now()
);
create index activity_log_sangh on public.activity_log (sangh_id, at desc);
alter table public.activity_log enable row level security;
create policy activity_admin_read on public.activity_log for select to authenticated using (private.is_sangh_admin(sangh_id));
create policy activity_write on public.activity_log for insert to authenticated
  with check (private.has_access(sangh_id) and actor = private.current_admin_phone());
revoke all on public.activity_log from anon, authenticated;
grant select, insert (sangh_id, actor, action, detail) on public.activity_log to authenticated;
grant usage on sequence public.activity_log_id_seq to authenticated;

-- Old entries go after a year.
create or replace function private.sweep() returns void
language sql security definer set search_path = '' as $$
  delete from private.otp_codes      where expires_at < now() - interval '1 hour';
  delete from private.otp_sends      where sent_at    < now() - interval '1 day';
  delete from private.rate_limits    where window_start < now() - interval '1 day';
  delete from public.accounts        where removed_at < now() - interval '30 days';
  delete from public.profiles        where removed_at < now() - interval '30 days';
  delete from private.admin_sessions where last_used_at < now() - interval '30 days';
  delete from public.activity_log    where at < now() - interval '1 year';
$$;
