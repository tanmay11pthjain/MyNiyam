-- DEMO ACCOUNTS for a presentation. Safe on the live database: it only adds, and runs once.
-- Remove them all later with `npm run db:demo:remove`.
--
--   Admin1   99999 00001   admin of HEER01 (log in at /admin/login)
--   User1    70000 00001   a member of HEER01 (log in at /login)
--
-- Login codes are simulated (1234) only for numbers listed in DEMO_PHONES on the server.
-- HEER01 gets five starter niyams only if it has none yet. User1 gets 14 days of history.
-- An earlier, bigger demo (User2 to User4) is trimmed back to these two.
do $$
declare
  heer uuid := (select id from public.sanghs where join_code = 'HEER01');
  fam record; acc uuid; prof uuid; cls uuid; n record; d int;
begin
  if heer is null then raise exception 'HEER01 not found: run npm run db:seed first'; end if;
  delete from public.accounts where phone = '+917000000002';
  delete from public.profiles p using public.accounts a
    where a.id = p.account_id and a.phone = '+917000000001' and p.name in ('User2', 'User3');
  if exists (select 1 from public.accounts where phone = '+917000000001') then
    raise notice 'demo accounts already exist; nothing to do';
    return;
  end if;

  insert into public.sangh_admins (sangh_id, phone, added_by) values (heer, '+919999900001', 'demo')
  on conflict do nothing;

  if not exists (select 1 from public.niyams where sangh_id = heer) then
    insert into public.niyams (sangh_id, name, name_hi, type, target, options, icon, note, is_core, sort_order) values
      (heer, 'Navkarsi', 'नवकारसी', 'yesno', null, '[]', 'sun', 'No food or water until 48 minutes after sunrise.', true, 1),
      (heer, 'Jinpuja', 'जिनपूजा', 'yesno', null, '[]', 'temple', null, true, 2),
      (heer, 'Navkar jaap', 'नवकार जाप', 'count', 108, '[]', 'mala', 'Count on a mala.', true, 3),
      (heer, 'Swadhyay', 'स्वाध्याय', 'duration', 30, '[]', 'book', null, false, 4),
      (heer, 'Tapasya', 'तपस्या', 'choice', null,
        '[{"value":"ekasna","en":"Ekasna","hi":"एकासना"},{"value":"biyasna","en":"Biyasna","hi":"बियासना"},{"value":"ayambil","en":"Ayambil","hi":"आयंबिल"},{"value":"upvas","en":"Upvas","hi":"उपवास"}]',
        'star', 'Which tapasya did you do today?', false, 5);
  end if;

  for fam in select * from (values
    ('+917000000001', 'User1', 'self', 'Yuva and adults', 'female', '1985-03-02')
  ) as t(phone, name, relation, class_name, gender, dob)
  loop
    select id into acc from public.accounts where phone = fam.phone;
    if acc is null then
      insert into public.accounts (phone, sangh_id, created_at) values (fam.phone, heer, now() - interval '15 days') returning id into acc;
    end if;
    select id into cls from public.classes where sangh_id = heer and name = fam.class_name;
    insert into public.profiles (account_id, class_id, name, relation, consent_at, consent_phone, setup_done_at, created_at)
    values (acc, cls, fam.name, fam.relation,
      case when fam.relation = 'child' then now() end, case when fam.relation = 'child' then fam.phone end,
      now() - interval '15 days', now() - interval '15 days')
    returning id into prof;
    insert into public.profile_answers (profile_id, answers)
    values (prof, jsonb_build_object('gender', fam.gender, 'dob', fam.dob, 'area', 'Demo area', 'school_std', 'college'));
  end loop;

  -- 14 days of history before today (today stays empty to tap through live). Old days are past the
  -- logging window, so the window check is set aside for this insert only.
  alter table public.niyam_logs disable trigger niyam_logs_window;
  for prof in select p.id from public.profiles p join public.accounts a on a.id = p.account_id
              where a.phone = '+917000000001' loop
    for d in 1..14 loop
      continue when (hashtext(prof::text || d::text) % 10 + 10) % 10 < 2;
      for n in select id, type, target, options from public.niyams where sangh_id = heer and status = 'active' loop
        continue when (hashtext(prof::text || d::text || n.id::text) % 10 + 10) % 10 < 3;
        insert into public.niyam_logs (profile_id, niyam_id, log_date, done, value, choice)
        values (prof, n.id, (now() at time zone 'Asia/Kolkata')::date - d, true,
          case when n.type = 'count' then 1 + (abs(hashtext(prof::text || d::text)) % 108)
               when n.type = 'duration' then 15 end,
          case when n.type = 'choice' then n.options -> 0 ->> 'value' end)
        on conflict do nothing;
      end loop;
    end loop;
  end loop;
  alter table public.niyam_logs enable trigger niyam_logs_window;
end $$;
