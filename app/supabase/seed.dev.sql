-- LOCAL DEV ONLY: a second demo pathshala so search, the city filter and the
-- "this number is already in another sangh" path can be tried. Not for production.
insert into public.sanghs (name, city, join_code) values
  ('Shantinath Pathshala (demo)', 'Ahmedabad', 'SHAN01'),
  ('Heer Kids Pathshala (demo)', 'Pune', 'HEERK2')
on conflict (join_code) do nothing;

insert into public.classes (sangh_id, name, name_hi, sort_order)
select s.id, 'All ages', 'सभी उम्र', 1 from public.sanghs s
where s.join_code in ('SHAN01', 'HEERK2')
on conflict (sangh_id, name) do nothing;
