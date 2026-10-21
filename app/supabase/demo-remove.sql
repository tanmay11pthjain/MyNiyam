-- Removes the demo accounts added by seed.demo.sql: the two demo numbers (with their people and logs)
-- and Admin1. The starter niyams stay; archive them on the admin's Niyams page if you don't want them.
delete from public.accounts where phone in ('+917000000001', '+917000000002');
delete from public.sangh_admins where phone = '+919999900001' and added_by = 'demo';
