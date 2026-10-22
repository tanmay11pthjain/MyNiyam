-- Tithi niyams: a niyam on dates the admin picks (Ashtami, Chaudas, Paryushan days, ...).
-- Tapasya levels: a choice niyam's options can each carry their own Tej (options[].points), so an
-- Upvas earns more than a Navkarsi. No column needed for that: options is already jsonb.
alter table public.niyams drop constraint niyams_schedule_check;
alter table public.niyams add constraint niyams_schedule_check check (schedule in ('daily', 'weekdays', 'range', 'dates'));
alter table public.niyams add column dates date[];
alter table public.niyams add constraint niyams_dates check (schedule <> 'dates' or cardinality(dates) between 1 and 120);
