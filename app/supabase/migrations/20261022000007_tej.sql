-- Tej: points a member earns each time they keep a niyam. The admin sets points per niyam.
-- A count or minutes niyam earns points for each count, up to 10 counts a day (so one big count
-- can't outweigh steady practice). Tej, kshama days and the streak are worked out from the logs.
alter table public.niyams add column points smallint not null default 10 check (points between 0 and 100);
