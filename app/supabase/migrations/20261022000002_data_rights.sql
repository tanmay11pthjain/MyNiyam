-- Data rights (DPDP): a family can delete all its data itself, and a sangh admin can delete a family's
-- data at once when the family asks (instead of the usual 30-day hidden removal).
-- Downloads need nothing new: the existing read policies already show a family its own rows and an admin
-- their sangh's rows.

-- The signed-in member deletes their own number and everyone on it, now. The server asks for a fresh
-- OTP before it calls this.
create function public.delete_my_account() returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.current_account_id();
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  delete from public.accounts where id = me;
  return found;
end $$;

-- A sangh admin deletes a family's data now, on the family's request. Works on a family that was
-- already removed (still hidden for 30 days) too.
create function public.admin_erase_family(target uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  select sangh_id into s from public.accounts where id = target for update;
  if s is null then return false; end if;
  if not private.is_sangh_admin(s) then
    raise exception 'not an admin of this sangh' using errcode = '42501';
  end if;
  delete from public.accounts where id = target;
  return true;
end $$;

revoke execute on function public.delete_my_account(), public.admin_erase_family(uuid) from public, anon;
grant execute on function public.delete_my_account(), public.admin_erase_family(uuid) to authenticated;
