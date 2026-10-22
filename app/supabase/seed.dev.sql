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

-- LOCAL DEV ONLY: an admin for HEER01 and SHAN01 (to try the sangh switcher), demo families,
-- a few niyams and 30 days of logs, so every admin screen has something to show.
-- Admin login: 99999 00001, code 1234. Super admin: SUPER_ADMIN_PHONE in .env.local.
insert into public.sangh_admins (sangh_id, phone, added_by)
select id, '+919999900001', 'seed' from public.sanghs where join_code in ('HEER01', 'SHAN01')
on conflict do nothing;

insert into public.sanghs (name, city, join_code, status, requested_by) values
  ('Mahavir Swami Pathshala (demo request)', 'Surat', 'MAHA01', 'pending', '+919999900002')
on conflict (join_code) do nothing;
insert into public.sangh_admins (sangh_id, phone, added_by)
select id, '+919999900002', 'seed' from public.sanghs where join_code = 'MAHA01'
on conflict do nothing;

do $$
declare
  heer uuid := (select id from public.sanghs where join_code = 'HEER01');
  fam record; acc uuid; prof uuid; cls uuid; n record; d int;
begin
  if exists (select 1 from public.accounts where phone = '+917000000001') then return; end if;

  insert into public.niyams (sangh_id, name, name_hi, type, target, icon, note, is_core, sort_order) values
    (heer, 'Navkarsi', 'नवकारसी', 'yesno', null, 'sun', 'No food or water until 48 minutes after sunrise.', true, 1),
    (heer, 'Jinpuja', 'जिनपूजा', 'yesno', null, 'temple', null, true, 2),
    (heer, 'Navkar jaap', 'नवकार जाप', 'count', 108, 'mala', 'Count on a mala.', true, 3),
    (heer, 'Swadhyay', 'स्वाध्याय', 'duration', 30, 'book', null, false, 4);

  for fam in select * from (values
    ('+917000000001', 'Meena Shah', 'self', 'Yuva and adults', 'female', '1984-03-02', 'Malad West', 'R-101'),
    ('+917000000001', 'Aarav Shah', 'child', 'Bal (age 8 to 12)', 'male', '2016-07-19', 'Malad West', 'R-102'),
    ('+917000000001', 'Siya Shah', 'child', 'Shishu (age 4 to 7)', 'female', '2020-01-11', 'Malad West', 'R-103'),
    ('+917000000002', 'Rakesh Jain', 'self', 'Yuva and adults', 'male', '1979-11-30', 'Borivali', 'R-104'),
    ('+917000000002', 'Kavya Jain', 'child', 'Kishor (age 13 to 17)', 'female', '2011-05-08', 'Borivali', 'R-105'),
    ('+917000000003', 'Hetal Mehta', 'self', 'Yuva and adults', 'female', '1992-09-14', 'Goregaon', 'R-106'),
    ('+917000000004', 'Dev Sanghvi', 'child', 'Bal (age 8 to 12)', 'male', '2015-02-25', 'Kandivali', 'R-107')
  ) as t(phone, name, relation, class_name, gender, dob, area, roll)
  loop
    select id into acc from public.accounts where phone = fam.phone;
    if acc is null then
      insert into public.accounts (phone, sangh_id, created_at) values (fam.phone, heer, now() - interval '40 days') returning id into acc;
    end if;
    select id into cls from public.classes where sangh_id = heer and name = fam.class_name;
    insert into public.profiles (account_id, class_id, name, relation, consent_at, consent_phone, setup_done_at, created_at)
    values (acc, cls, fam.name, fam.relation,
      case when fam.relation = 'child' then now() - interval '40 days' end,
      case when fam.relation = 'child' then fam.phone end,
      now() - interval '40 days', now() - interval '40 days')
    returning id into prof;
    insert into public.profile_answers (profile_id, answers)
    values (prof, jsonb_build_object('gender', fam.gender, 'dob', fam.dob, 'area', fam.area, 'roll_no', fam.roll));
  end loop;

  -- 30 days of logs, older than the logging window allows, so the window check is set aside here only.
  alter table public.niyam_logs disable trigger niyam_logs_window;
  for prof in select p.id from public.profiles p join public.accounts a on a.id = p.account_id where a.sangh_id = heer loop
    for d in 0..29 loop
      continue when (hashtext(prof::text || d::text) % 10 + 10) % 10 < 3;                     -- some days missed
      continue when d < 4 and (select name from public.profiles where id = prof) = 'Dev Sanghvi'; -- not logged lately
      for n in select id, type, target from public.niyams where sangh_id = heer loop
        continue when (hashtext(prof::text || d::text || n.id::text) % 10 + 10) % 10 < 2;
        insert into public.niyam_logs (profile_id, niyam_id, log_date, done, value)
        values (prof, n.id, (now() at time zone 'Asia/Kolkata')::date - d, true,
                case when n.type in ('count', 'duration') then n.target end);
      end loop;
    end loop;
  end loop;
  alter table public.niyam_logs enable trigger niyam_logs_window;
end $$;

-- LOCAL DEV ONLY: the demo student. Log in at /login with 70000 00001 and code 1234 (Meena, Aarav and Siya Shah).
-- One niyam of each type, and a clean "today" so the Today screen starts empty. Safe to run again.
insert into public.niyams (sangh_id, name, name_hi, type, target, options, icon, note, is_core, sort_order)
select s.id, 'Tapasya', 'तपस्या', 'choice', null,
  '[{"value":"biyasna","en":"Biyasna","hi":"बियासना","points":20},{"value":"ekasna","en":"Ekasna","hi":"एकासना","points":30},{"value":"ayambil","en":"Ayambil","hi":"आयंबिल","points":50},{"value":"upvas","en":"Upvas","hi":"उपवास","points":100}]'::jsonb,
  'star', 'Which tapasya did you do today?', false, 5
from public.sanghs s
where s.join_code = 'HEER01' and not exists (select 1 from public.niyams n where n.sangh_id = s.id and n.name = 'Tapasya');

delete from public.niyam_logs
where log_date = (now() at time zone 'Asia/Kolkata')::date
  and profile_id in (select p.id from public.profiles p join public.accounts a on a.id = p.account_id where a.phone = '+917000000001');

-- Navkarsi cards show "By <sunrise + 48 min>".
update public.niyams set time_hint = 'navkarsi' where name = 'Navkarsi' and time_hint is null;
