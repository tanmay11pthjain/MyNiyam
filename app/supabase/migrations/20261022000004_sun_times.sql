-- Navkarsi and Chauvihar times: where the sangh is (for sunrise and sunset), and which niyams show a time.
alter table public.sanghs
  add column lat double precision check (lat between 6 and 38),     -- India only
  add column lon double precision check (lon between 68 and 98),
  add constraint sanghs_latlon check ((lat is null) = (lon is null));
grant update (lat, lon) on public.sanghs to authenticated;

-- navkarsi: "by <sunrise + 48 min>". chauvihar: "before <sunset>".
alter table public.niyams add column time_hint text check (time_hint in ('navkarsi', 'chauvihar'));
update public.niyams set time_hint = 'navkarsi' where lower(name) like 'navkars%';
update public.niyams set time_hint = 'chauvihar' where lower(name) like 'chauvih%' or lower(name) like 'chovih%';
