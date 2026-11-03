-- One phone number in many pathshalas (up to 5).
-- Each pathshala still gets its own account row for the number, with its own people, logs, streaks and AP,
-- so every row-level rule stays exactly as it was: a session is always inside one pathshala.
-- The old rule was UNIQUE(phone); now it is one row per (phone, pathshala). A removed account has no phone.
alter table public.accounts drop constraint accounts_phone_key;
create unique index accounts_phone_sangh on public.accounts (phone, sangh_id) where phone is not null;
create index accounts_phone on public.accounts (phone) where phone is not null;

-- At most 5 pathshalas per number (mirrors MAX_PATHSHALAS_PER_PHONE in config).
create function private.check_account_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.phone is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('accounts:' || new.phone)); -- serialise two joins at once
  if (select count(*) from public.accounts where phone = new.phone and id <> new.id) >= 5 then
    raise exception 'this number is already in 5 pathshalas' using errcode = 'P0001', hint = 'pathshala_limit';
  end if;
  return new;
end $$;
create trigger accounts_limit before insert or update of phone on public.accounts
  for each row execute function private.check_account_count();
