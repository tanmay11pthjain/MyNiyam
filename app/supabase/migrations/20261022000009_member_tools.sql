-- Member tools: admins (and volunteers with "setup" in their classes) can correct a member's
-- answers; an admin can hand the pathshala over to another number (both numbers verified by OTP).

-- A volunteer with "setup" sees the people in their classes (names and answers) so they can fix them.
create policy profiles_setup_read on public.profiles for select to authenticated
  using (private.can_on_profile(id, 'setup'));
create policy answers_setup_read on public.profile_answers for select to authenticated
  using (private.can_on_profile(profile_id, 'setup'));
create policy answers_staff_insert on public.profile_answers for insert to authenticated
  with check (private.can_on_profile(profile_id, 'setup'));
create policy answers_staff_update on public.profile_answers for update to authenticated
  using (private.can_on_profile(profile_id, 'setup')) with check (private.can_on_profile(profile_id, 'setup'));

-- Hand over: the new number becomes an admin and the caller stops being one. The server checks both
-- OTPs before calling this. Other admins stay as they are.
create function public.transfer_sangh(target uuid, new_phone text) returns void
language plpgsql security definer set search_path = '' as $$
declare me text := private.current_admin_phone();
begin
  if not private.is_sangh_admin(target) then
    raise exception 'only an admin can hand over a pathshala' using errcode = '42501';
  end if;
  if new_phone = me then
    raise exception 'that is your own number' using errcode = 'P0001', hint = 'same_number';
  end if;
  insert into public.sangh_admins (sangh_id, phone, added_by) values (target, new_phone, me) on conflict do nothing;
  delete from public.sangh_volunteers where sangh_id = target and phone = new_phone;
  delete from public.sangh_admins where sangh_id = target and phone = me;
  insert into public.activity_log (sangh_id, actor, action, detail) values (target, me, 'Handed over the pathshala', new_phone);
end $$;
revoke execute on function public.transfer_sangh(uuid, text) from public, anon;
grant execute on function public.transfer_sangh(uuid, text) to authenticated;

-- The sangh a person belongs to (for checks that can't read accounts).
create function private.profile_sangh(pid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.sangh_id from public.profiles p join public.accounts a on a.id = p.account_id where p.id = pid
$$;
grant execute on function private.profile_sangh(uuid) to authenticated;
