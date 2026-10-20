-- Seed: the first pathshala, Heer (join code HEER01), and its classes. Safe to run twice.
insert into public.sanghs (name, city, join_code, form_fields) values (
  'Shree Heer Jain Pathshala', 'Mumbai', 'HEER01',
  '[
    {"key": "dob", "type": "date", "required": false,
     "label": {"en": "Date of birth", "hi": "जन्म तिथि"}},
    {"key": "school_std", "type": "select", "required": false,
     "label": {"en": "School class", "hi": "स्कूल की कक्षा"},
     "options": [
       {"value": "none", "en": "Not in school", "hi": "स्कूल नहीं जाते"},
       {"value": "1-4", "en": "1st to 4th", "hi": "पहली से चौथी"},
       {"value": "5-8", "en": "5th to 8th", "hi": "पाँचवीं से आठवीं"},
       {"value": "9-12", "en": "9th to 12th", "hi": "नौवीं से बारहवीं"},
       {"value": "college", "en": "College or working", "hi": "कॉलेज या नौकरी"}
     ]},
    {"key": "area", "type": "text", "required": true, "max": 60,
     "label": {"en": "Your area", "hi": "आपका इलाका"},
     "placeholder": "e.g. Malad West"}
  ]'::jsonb
) on conflict (join_code) do nothing;

insert into public.classes (sangh_id, name, name_hi, sort_order)
select s.id, c.name, c.name_hi, c.sort_order
from public.sanghs s
cross join (values
  ('Shishu (age 4 to 7)',  'शिशु (4 से 7 साल)',  1),
  ('Bal (age 8 to 12)',    'बाल (8 से 12 साल)',   2),
  ('Kishor (age 13 to 17)', 'किशोर (13 से 17 साल)', 3),
  ('Yuva and adults',      'युवा और बड़े',          4)
) as c(name, name_hi, sort_order)
where s.join_code = 'HEER01'
on conflict (sangh_id, name) do nothing;
