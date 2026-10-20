-- MyNiyam onboarding: sanghs, classes, accounts (one phone = one sangh), profiles, answers.
-- Runs on Supabase (Postgres 15+) and on the local Docker Postgres used for dev and tests.
-- The app server connects as the database owner and switches to the `authenticated` role
-- (with request.jwt.claims set) for every query made on behalf of a signed-in account,
-- so the row-level security below is what keeps each sangh's data separate.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Private schema: helpers and server-only tables. Not exposed through the Supabase API.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Sanghs (pathshalas)
-- ---------------------------------------------------------------------------
create table public.sanghs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 2 and 120),
  city        text not null check (length(city) between 2 and 80),
  logo_url    text,
  join_code   text not null unique check (join_code ~ '^[A-Z0-9]{6}$'),
  -- Admin-defined sign-up questions. See src/lib/forms.ts for the shape.
  form_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(form_fields) = 'array'),
  created_at  timestamptz not null default now()
);
create index sanghs_name_search on public.sanghs (lower(name) text_pattern_ops);
create index sanghs_city on public.sanghs (lower(city));

-- ---------------------------------------------------------------------------
-- Classes / levels inside a sangh
-- ---------------------------------------------------------------------------
create table public.classes (
  id         uuid primary key default gen_random_uuid(),
  sangh_id   uuid not null references public.sanghs(id) on delete cascade,
  name       text not null check (length(name) between 1 and 80),
  name_hi    text,
  sort_order int  not null default 0,
  unique (sangh_id, name)
);
create index classes_sangh on public.classes (sangh_id, sort_order);

-- ---------------------------------------------------------------------------
-- Accounts: one verified phone number, in exactly one sangh.
-- The UNIQUE on phone is the "1 number = 1 sangh" rule. Deleting the account frees the number.
-- ---------------------------------------------------------------------------
create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null unique check (phone ~ '^\+91[6-9][0-9]{9}$'),
  sangh_id   uuid not null references public.sanghs(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index accounts_sangh on public.accounts (sangh_id);

-- ---------------------------------------------------------------------------
-- Profiles: the people who use one account ("Myself", "My child", ...)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  class_id      uuid references public.classes(id) on delete set null,
  name          text not null check (length(btrim(name)) between 1 and 60),
  photo_url     text,
  role          text not null default 'student' check (role in ('student', 'volunteer', 'admin')),
  relation      text not null check (relation in ('self', 'child')),
  -- DPDP Act: a child's profile needs consent from the verified number's owner.
  consent_at    timestamptz,
  consent_phone text,
  setup_done_at timestamptz,
  created_at    timestamptz not null default now(),
  constraint child_needs_consent check (relation <> 'child' or (consent_at is not null and consent_phone is not null))
);
create index profiles_account on public.profiles (account_id, created_at);
-- At most one "Myself" per number.
create unique index profiles_one_self on public.profiles (account_id) where relation = 'self';

-- A profile's class must belong to the account's sangh.
create function private.check_profile_class() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.class_id is not null and not exists (
    select 1 from public.classes c join public.accounts a on a.sangh_id = c.sangh_id
    where c.id = new.class_id and a.id = new.account_id
  ) then
    raise exception 'class does not belong to this sangh' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger profiles_class_in_sangh before insert or update of class_id, account_id on public.profiles
  for each row execute function private.check_profile_class();

-- Never more than this many profiles on one number (mirrors MAX_PROFILES_PER_ACCOUNT in config).
create function private.check_profile_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.accounts where id = new.account_id for update; -- serialise concurrent adds
  if (select count(*) from public.profiles where account_id = new.account_id) >= 8 then
    raise exception 'too many profiles on this number' using errcode = 'P0001', hint = 'profile_limit';
  end if;
  return new;
end $$;
create trigger profiles_limit before insert on public.profiles
  for each row execute function private.check_profile_count();

-- ---------------------------------------------------------------------------
-- Answers to the sangh's sign-up questions, one row per profile.
-- ---------------------------------------------------------------------------
create table public.profile_answers (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  answers    jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Server-only: OTP codes, send log (for the per-number limit) and generic rate-limit counters.
-- ---------------------------------------------------------------------------
create table private.otp_codes (
  phone      text primary key,
  code_hash  text not null,
  channel    text not null check (channel in ('whatsapp', 'sms')),
  attempts   int  not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table private.otp_sends (
  id      bigint generated always as identity primary key,
  phone   text not null,
  channel text not null,
  sent_at timestamptz not null default now()
);
create index otp_sends_phone_time on private.otp_sends (phone, sent_at desc);

create table private.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);

-- Deletes expired OTPs and old counters. Safe to run from many places at once.
-- On Supabase schedule it with pg_cron:  select cron.schedule('myniyam-sweep', '*/15 * * * *', 'select private.sweep()');
create function private.sweep() returns void
language sql security definer set search_path = '' as $$
  delete from private.otp_codes   where expires_at < now() - interval '1 hour';
  delete from private.otp_sends   where sent_at    < now() - interval '1 day';
  delete from private.rate_limits where window_start < now() - interval '1 day';
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Same claim Supabase's auth.uid() reads, so the policies work with Supabase JWTs too.
create function private.current_account_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create function private.current_sangh_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select sangh_id from public.accounts where id = private.current_account_id()
$$;

create function private.current_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles where account_id = private.current_account_id() and role = 'admin'
  )
$$;

alter table public.sanghs          enable row level security;
alter table public.classes         enable row level security;
alter table public.accounts        enable row level security;
alter table public.profiles        enable row level security;
alter table public.profile_answers enable row level security;
alter table private.otp_codes      enable row level security;
alter table private.otp_sends      enable row level security;
alter table private.rate_limits    enable row level security;

-- Members see only their own sangh and its classes.
create policy sangh_member_read on public.sanghs for select to authenticated
  using (id = private.current_sangh_id());
create policy classes_member_read on public.classes for select to authenticated
  using (sangh_id = private.current_sangh_id());

-- An account sees only itself.
create policy account_self_read on public.accounts for select to authenticated
  using (id = private.current_account_id());

-- Profiles: full access to your own; admins can read their sangh's.
create policy profiles_own on public.profiles for all to authenticated
  using (account_id = private.current_account_id())
  with check (account_id = private.current_account_id());
create policy profiles_admin_read on public.profiles for select to authenticated
  using (private.current_is_admin() and exists (
    select 1 from public.accounts a where a.id = profiles.account_id and a.sangh_id = private.current_sangh_id()
  ));

create policy answers_own on public.profile_answers for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.account_id = private.current_account_id()))
  with check (exists (select 1 from public.profiles p where p.id = profile_id and p.account_id = private.current_account_id()));

-- Table and column grants. Supabase grants everything on new public tables to anon and
-- authenticated by default, so start from nothing. Role and consent can't be set or changed
-- by a member: those columns are simply not granted.
revoke all on public.sanghs, public.classes, public.accounts, public.profiles, public.profile_answers from anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.current_account_id(), private.current_sangh_id(), private.current_is_admin() to authenticated;
grant select on public.sanghs, public.classes, public.accounts to authenticated;
grant select, delete on public.profiles to authenticated;
grant insert (account_id, name, relation, consent_at, consent_phone) on public.profiles to authenticated;
grant update (name, class_id, setup_done_at) on public.profiles to authenticated;
grant select, insert, update on public.profile_answers to authenticated;

-- Admin removes a number from their sangh. Deleting the account frees the number for another sangh.
create function public.admin_remove_account(target_phone text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if not private.current_is_admin() then
    raise exception 'only a sangh admin can remove a number' using errcode = '42501';
  end if;
  select id into target from public.accounts
    where phone = target_phone and sangh_id = private.current_sangh_id()
    for update;
  if target is null then return false; end if;
  if target = private.current_account_id() then
    raise exception 'an admin cannot remove their own number' using errcode = 'P0001';
  end if;
  delete from public.accounts where id = target;
  return true;
end $$;
revoke execute on function public.admin_remove_account(text) from public, anon;
grant execute on function public.admin_remove_account(text) to authenticated;
