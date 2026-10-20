-- The super admin sees how many families each sangh has, without seeing the families themselves
-- (accounts stay visible only to that sangh's own admins).
create function public.super_family_counts() returns table (sangh_id uuid, families int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  return query select a.sangh_id, count(*)::int from public.accounts a where a.removed_at is null group by a.sangh_id;
end $$;
revoke execute on function public.super_family_counts() from public, anon;
grant execute on function public.super_family_counts() to authenticated;
