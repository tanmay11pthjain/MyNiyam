-- Login codes log: every code we create, with its number, so the super admin can check a code with a
-- member on the phone ("which code did you get?") and see whether the SMS phone sent and delivered it.
-- Server-only (private schema, row level security on, no policies). Kept 30 days.

create table private.otp_log (
  id          bigint generated always as identity primary key,
  phone       text not null,
  code        text not null,
  delivery    text not null check (delivery in ('practice', 'msg91', 'phone')),
  channel     text not null check (channel in ('whatsapp', 'sms')),
  -- practice: 1234, nothing sent · sending: being handed over · queued: the phone has it
  -- sent / delivered / failed: as reported · verified: the member typed it in
  status      text not null check (status in ('practice', 'sending', 'queued', 'sent', 'delivered', 'failed', 'verified')),
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  verified_at timestamptz
);
create index otp_log_time on private.otp_log (created_at desc);
create index otp_log_phone on private.otp_log (phone, id desc);
alter table private.otp_log enable row level security;

-- The 24-hour code limit needs a day of sends; the daily cleanup also drops log rows after 30 days.
create or replace function private.sweep() returns void
language sql security definer set search_path = '' as $$
  delete from private.otp_codes      where expires_at < now() - interval '1 hour';
  delete from private.otp_sends      where sent_at    < now() - interval '2 days';
  delete from private.otp_log        where created_at < now() - interval '30 days';
  delete from private.rate_limits    where window_start < now() - interval '1 day';
  delete from public.accounts        where removed_at < now() - interval '30 days';
  delete from public.profiles        where removed_at < now() - interval '30 days';
  delete from private.admin_sessions where last_used_at < now() - interval '30 days';
  delete from public.activity_log    where at < now() - interval '1 year';
  delete from public.streak_repairs  where repaired_at < now() - interval '1 year';
  delete from private.push_subs      where fails >= 5;
$$;
