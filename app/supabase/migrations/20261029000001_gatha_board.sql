-- Gathas recited, counted with attendance; the weekly class board on for every class; the admin's
-- view of a class's week (for the top-3 poster).

alter table public.attendance add column gathas smallint not null default 0 check (gathas between 0 and 999);

-- The board is on by default. Every class turns it on now; an admin can still turn one off.
alter table public.classes alter column leaderboard set default true;
update public.classes set leaderboard = true where not leaderboard;

-- A class's days kept in one week (Monday to Sunday, or to today), for admins and volunteers who may
-- view its members. Names as the board shows them; the photo only when the person shows their name.
create function public.admin_class_week(cls uuid, week_start date)
returns table (rank int, profile_id uuid, name text, photo_url text, days int)
language sql stable security definer set search_path = '' as $$
  with c as (
    select c.id from public.classes c
    where c.id = cls and private.has_perm(c.sangh_id, 'view_members') and private.class_in_scope(c.sangh_id, c.id)),
  m as (
    select p.id, p.name, p.board_initials, p.photo_url,
      (select count(distinct l.log_date) from public.niyam_logs l
       where l.profile_id = p.id and l.done
         and l.log_date between week_start and least(week_start + 6, private.local_today()))::int as days
    from c join public.profiles p on p.class_id = c.id and p.removed_at is null
    join public.accounts a on a.id = p.account_id and a.removed_at is null)
  select (rank() over (order by days desc))::int, id,
    case when board_initials then private.initials(name) else private.short_name(name) end,
    case when board_initials then null else photo_url end, days
  from m order by days desc, name
$$;
revoke execute on function public.admin_class_week(uuid, date) from public, anon;
grant execute on function public.admin_class_week(uuid, date) to authenticated;
