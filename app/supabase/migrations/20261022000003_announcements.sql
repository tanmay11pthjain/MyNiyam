-- Announcements: slides the sangh admin posts, shown in a slim card on members' Today screen.
-- An announcement goes to the whole sangh or to chosen classes, between optional start and end dates.
-- One can be pinned first; the rest follow the admin's order. Views are counted per person.

create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  sangh_id     uuid not null references public.sanghs(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 60),
  body         text check (length(body) <= 200),
  image_url    text check (length(image_url) <= 300),
  button_label text check (length(button_label) <= 30),
  button_url   text check (button_url ~ '^https://' and length(button_url) <= 500),
  all_classes  boolean not null default true,
  start_date   date,
  end_date     date,
  pinned       boolean not null default false,
  sort_order   int not null default 0,
  created_by   text,
  created_at   timestamptz not null default now(),
  constraint announcements_dates check (start_date is null or end_date is null or start_date <= end_date),
  constraint announcements_button check ((button_label is null) = (button_url is null))
);
create index announcements_sangh on public.announcements (sangh_id, pinned desc, sort_order);
-- At most one pinned announcement per sangh.
create unique index announcements_one_pin on public.announcements (sangh_id) where pinned;

create table public.announcement_classes (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  class_id        uuid not null references public.classes(id) on delete cascade,
  primary key (announcement_id, class_id)
);
create index announcement_classes_class on public.announcement_classes (class_id);

create function private.check_announcement_class() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.announcements an join public.classes c on c.sangh_id = an.sangh_id
    where an.id = new.announcement_id and c.id = new.class_id
  ) then
    raise exception 'class does not belong to this sangh' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger announcement_classes_same_sangh before insert or update on public.announcement_classes
  for each row execute function private.check_announcement_class();

create table public.announcement_views (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  seen_at         timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);
create index announcement_views_profile on public.announcement_views (profile_id);

alter table public.announcements        enable row level security;
alter table public.announcement_classes enable row level security;
alter table public.announcement_views   enable row level security;

create policy announcements_admin on public.announcements for all to authenticated
  using (private.is_sangh_admin(sangh_id)) with check (private.is_sangh_admin(sangh_id));
-- Members see their own sangh's announcements; the server picks the ones for their class and dates.
create policy announcements_member_read on public.announcements for select to authenticated
  using (sangh_id = private.current_sangh_id());

create policy announcement_classes_admin on public.announcement_classes for all to authenticated
  using (exists (select 1 from public.announcements an where an.id = announcement_id and private.is_sangh_admin(an.sangh_id)))
  with check (exists (select 1 from public.announcements an where an.id = announcement_id and private.is_sangh_admin(an.sangh_id)));
create policy announcement_classes_member_read on public.announcement_classes for select to authenticated
  using (exists (select 1 from public.announcements an where an.id = announcement_id and an.sangh_id = private.current_sangh_id()));

create policy announcement_views_own on public.announcement_views for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.account_id = private.current_account_id() and p.removed_at is null))
  with check (exists (select 1 from public.profiles p where p.id = profile_id and p.account_id = private.current_account_id() and p.removed_at is null)
    and exists (select 1 from public.announcements an where an.id = announcement_id and an.sangh_id = private.current_sangh_id()));
create policy announcement_views_admin_read on public.announcement_views for select to authenticated
  using (exists (select 1 from public.announcements an where an.id = announcement_id and private.is_sangh_admin(an.sangh_id)));

revoke all on public.announcements, public.announcement_classes, public.announcement_views from anon, authenticated;
grant select, insert, update, delete on public.announcements, public.announcement_classes to authenticated;
grant select, insert on public.announcement_views to authenticated;
