-- Boards by Tej points: the class board members see (this week) and the admin's board over any dates
-- (for the top-3 poster). One function holds the Tej rule, so every total in the app agrees.

-- Tej for one kept log: the niyam's points; for count and minutes niyams, points for each count up to
-- 10 a day; for a tapasya level, that level's own points if it has them.
create function private.log_tej(n_type text, n_points int, n_options jsonb, l_value int, l_choice text) returns int
language sql immutable set search_path = '' as $$
  select case
    when n_type in ('count', 'duration') then least(greatest(coalesce(l_value, 1), 1), 10) * n_points
    when n_type = 'choice' then coalesce((select (o ->> 'points')::int from jsonb_array_elements(n_options) o where o ->> 'value' = l_choice limit 1), n_points)
    else n_points end
$$;

-- My class this week (Monday to today), most Tej first; days kept break a tie.
drop function public.class_board(uuid);
create function public.class_board(viewer uuid) returns table (rank int, name text, points int, days int, me boolean)
language sql stable security definer set search_path = '' as $$
  with v as (
    select p.class_id from public.profiles p join public.classes c on c.id = p.class_id
    where p.id = viewer and private.own_profile(viewer) and c.leaderboard),
  wk as (select private.local_today() - (extract(isodow from private.local_today())::int - 1) as start),
  m as (
    select p.id, p.name, p.board_initials,
      coalesce((select sum(private.log_tej(n.type, n.points, n.options, l.value, l.choice)) from public.niyam_logs l
        join public.niyams n on n.id = l.niyam_id, wk
        where l.profile_id = p.id and l.done and l.log_date between wk.start and private.local_today()), 0)::int as points,
      (select count(distinct l.log_date) from public.niyam_logs l, wk
       where l.profile_id = p.id and l.done and l.log_date between wk.start and private.local_today())::int as days
    from v join public.profiles p on p.class_id = v.class_id and p.removed_at is null
    join public.accounts a on a.id = p.account_id and a.removed_at is null)
  select (rank() over (order by points desc, days desc))::int,
    case when board_initials then private.initials(name) else private.short_name(name) end, points, days, id = viewer
  from m order by points desc, days desc, name
$$;
revoke execute on function public.class_board(uuid) from public, anon;
grant execute on function public.class_board(uuid) to authenticated;

-- A class over chosen dates, for admins and volunteers who may view its members. Names as the board
-- shows them; the photo only when the person shows their name.
drop function public.admin_class_week(uuid, date);
create function public.admin_class_points(cls uuid, from_day date, to_day date)
returns table (rank int, profile_id uuid, name text, photo_url text, points int, days int)
language sql stable security definer set search_path = '' as $$
  with c as (
    select c.id from public.classes c
    where c.id = cls and private.has_perm(c.sangh_id, 'view_members') and private.class_in_scope(c.sangh_id, c.id)),
  m as (
    select p.id, p.name, p.board_initials, p.photo_url,
      coalesce((select sum(private.log_tej(n.type, n.points, n.options, l.value, l.choice)) from public.niyam_logs l
        join public.niyams n on n.id = l.niyam_id
        where l.profile_id = p.id and l.done and l.log_date between from_day and to_day), 0)::int as points,
      (select count(distinct l.log_date) from public.niyam_logs l
       where l.profile_id = p.id and l.done and l.log_date between from_day and to_day)::int as days
    from c join public.profiles p on p.class_id = c.id and p.removed_at is null
    join public.accounts a on a.id = p.account_id and a.removed_at is null)
  select (rank() over (order by points desc, days desc))::int, id,
    case when board_initials then private.initials(name) else private.short_name(name) end,
    case when board_initials then null else photo_url end, points, days
  from m order by points desc, days desc, name
$$;
revoke execute on function public.admin_class_points(uuid, date, date) from public, anon;
grant execute on function public.admin_class_points(uuid, date, date) to authenticated;
