# MyNiyam app: join your pathshala

Next.js 16 (App Router, TypeScript) PWA with Postgres (Supabase in production). This slice covers the backend for joining a pathshala, plus the minimal screens that drive it: find a sangh (6-character code, QR link `/j/CODE`, or name search with a city filter), confirm it, verify a +91 number by OTP, pick or add a profile ("Myself" / "My child" with parental consent), then pick a class and answer the sangh's questions.

## Admin panel (/admin)

Mobile-first, English for now. Pathshala admins log in with the same phone + OTP and get:
- **Home**: today's logging (people, %, niyams kept), a setup checklist for a new pathshala, quick actions.
- **Members**: families (numbers masked), search, filters, a person's page (answers, streak, last 30 days, parental consent), change class, remove a person or a family.
- **Niyams**: a ready list or your own; done/not done, a number, minutes or one option; classes, days, core or optional; pause or archive; the logging window (yesterday allowed, or today only).
- **Setup**: join code, QR, PNG, A4 poster, join on/off, name search on/off, details and logo; classes; the join form builder with live preview.
- **Super admin** (`SUPER_ADMIN_PHONE` only): approve new pathshalas, add them, assign admins.

Demo locally: `npm run db:seed:dev`, then log in at /admin/login with 99999 00001 and code 1234. See [docs/SETUP.md](docs/SETUP.md) Part E.

## Run it locally

Needs Node 22+ and Docker.

```bash
npm install
npm run db:up          # Postgres 17 on 127.0.0.1:54329 (dev and test databases)
cp .env.example .env.local   # then set DATABASE_URL and SESSION_SECRET
npm run db:migrate
npm run db:seed        # HEER01 and its classes
npm run db:seed:dev    # two demo sanghs (SHAN01, HEERK2), local only
npm run dev            # http://localhost:3100 (fails clearly if the port is taken)
```

Login codes are simulated for now (`OTP_DELIVERY=simulate`): no message is sent and the code is always `1234`. The MSG91 delivery code is in place; set `OTP_DELIVERY=msg91` to turn it on. In production the server refuses simulation unless `ALLOW_OTP_SIMULATION_IN_PRODUCTION=true`.

## Tests

```bash
npm test                                   # unit + database tests (resets the myniyam_test database)
BASE_URL=http://localhost:3100 node scripts/api-check.mjs   # HTTP checks of every route (server in test mode)
```

## Where things are

- `supabase/migrations/` schema, constraints, row-level security. `supabase/seed.sql` seeds HEER01.
- `src/server/otp.ts` `sendOtp(phone, channel)` and `verifyOtp(phone, code)`; `src/server/msg91.ts` delivery (WhatsApp, SMS).
- `src/server/onboarding.ts` data access; `src/app/api/**` the JSON API; `src/client/**` the screens.
- Admin: `src/server/admin/*` (data access, session, route wrappers), `src/app/api/admin/**`, `src/client/admin/*`, `src/app/admin/**`. Shared contract in `src/lib/admin-types.ts`; join form model in `src/lib/forms.ts`; niyam library in `src/lib/niyam-library.ts`; storage in `src/server/storage.ts`.

## Rules enforced in the database

- One number = one sangh: `accounts.phone` is UNIQUE; parallel joins create one account.
- A child profile needs consent (`child_needs_consent` check); at most one "Myself" and 8 profiles per number.
- Row-level security: a signed-in account sees only its own sangh, classes, account and profiles. The server runs member queries as the `authenticated` role with Supabase-style JWT claims.
- An admin can remove a number from their own sangh (`admin_remove_family`), which frees the number at once; the family and its logs are hidden and deleted by `private.sweep()` after 30 days. One person can be removed the same way (`admin_remove_profile`).
- Admins are phone numbers in `sangh_admins`, separate from membership: one number can run several sanghs. Admin queries run as the `authenticated` role with an `admin_phone` claim, and row-level security limits them to their own sanghs. Admin sessions live in `private.admin_sessions` and end after 30 days unused.
- Only the super admin approves (`super_approve_sangh`) or creates sanghs. A pending sangh, or one with joins paused, can't take new accounts (`accounts_join_open` trigger); existing members still get in.
- A class with members can't be deleted (`classes_no_delete_with_members`).
- Logging window: a niyam log for day D is accepted until D ends plus `sanghs.log_back_hours` (24 or 0), Indian time, never for a future day (`niyam_logs_window` trigger).
- Changing the join form never breaks members: newly required questions are asked the next time they open the app, and answers to removed questions are kept.
- OTP: 4 digits, 5-minute expiry, single use, 5 wrong tries, 3 sends per number per 10 minutes, 30 s between sends. Per-IP limits on sends, verifies and lookups. All counters live in Postgres, so they work across instances.

## Environment variables

See `.env.example`. Secrets are read only by server code; nothing is `NEXT_PUBLIC_`.

| Name | Needed for |
| --- | --- |
| `DATABASE_URL` | Supabase transaction-pooler URL (port 6543), Mumbai region |
| `SESSION_SECRET` | signing the session cookie and hashing OTPs (32+ random chars) |
| `MSG91_AUTH_KEY`, `MSG91_SMS_TEMPLATE_ID` | SMS codes (DLT-approved OTP template) |
| `MSG91_WHATSAPP_NUMBER`, `MSG91_WHATSAPP_TEMPLATE`, `MSG91_WHATSAPP_NAMESPACE` | WhatsApp codes (approved authentication template) |
| `OTP_DELIVERY` | `simulate` (default, code is always 1234) or `msg91` |
| `SUPER_ADMIN_PHONE` | the super admin's +91 number (comma-separated for several) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | logo and photo uploads (private bucket `STORAGE_BUCKET`, default `myniyam`); without them, uploads go to `.data/storage` in dev and are refused in production |

## Supabase setup

1. Create a project in region `ap-south-1` (Mumbai).
2. Put its transaction-pooler connection string in `DATABASE_URL`.
3. `npm run db:migrate && npm run db:seed`.
4. Optional: schedule cleanup with pg_cron: `select cron.schedule('myniyam-sweep', '*/15 * * * *', 'select private.sweep()');`

Step-by-step setup for Supabase and MSG91: [docs/SETUP.md](docs/SETUP.md).
