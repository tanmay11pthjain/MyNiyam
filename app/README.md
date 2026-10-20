# MyNiyam app: join your pathshala

Next.js 16 (App Router, TypeScript) PWA with Postgres (Supabase in production). This slice covers the backend for joining a pathshala, plus the minimal screens that drive it: find a sangh (6-character code, QR link `/j/CODE`, or name search with a city filter), confirm it, verify a +91 number by OTP, pick or add a profile ("Myself" / "My child" with parental consent), then pick a class and answer the sangh's questions.

## Run it locally

Needs Node 22+ and Docker.

```bash
npm install
npm run db:up          # Postgres 17 on 127.0.0.1:54329 (dev and test databases)
cp .env.example .env.local   # then set SESSION_SECRET; OTP_TEST_MODE=true until MSG91 keys are in
npm run db:migrate
npm run db:seed        # HEER01 and its classes
npm run db:seed:dev    # two demo sanghs (SHAN01, HEERK2), local only
npm run dev            # http://localhost:3100 (fails clearly if the port is taken)
```

With `OTP_TEST_MODE=true` no message is sent and the code is always `123456`. The server refuses test mode when `NODE_ENV=production`.

## Tests

```bash
npm test                                   # unit + database tests (resets the myniyam_test database)
BASE_URL=http://localhost:3100 node scripts/api-check.mjs   # HTTP checks of every route (server in test mode)
```

## Where things are

- `supabase/migrations/` schema, constraints, row-level security. `supabase/seed.sql` seeds HEER01.
- `src/server/otp.ts` `sendOtp(phone, channel)` and `verifyOtp(phone, code)`; `src/server/msg91.ts` delivery (WhatsApp, SMS).
- `src/server/onboarding.ts` data access; `src/app/api/**` the JSON API; `src/client/**` the screens.

## Rules enforced in the database

- One number = one sangh: `accounts.phone` is UNIQUE; parallel joins create one account.
- A child profile needs consent (`child_needs_consent` check); at most one "Myself" and 8 profiles per number.
- Row-level security: a signed-in account sees only its own sangh, classes, account and profiles. The server runs member queries as the `authenticated` role with Supabase-style JWT claims.
- An admin can remove a number from their own sangh (`admin_remove_account`), which deletes its profiles and frees the number.
- OTP: 6 digits, 5-minute expiry, single use, 5 wrong tries, 3 sends per number per 10 minutes, 30 s between sends. Per-IP limits on sends, verifies and lookups. All counters live in Postgres, so they work across instances.

## Environment variables

See `.env.example`. Secrets are read only by server code; nothing is `NEXT_PUBLIC_`.

| Name | Needed for |
| --- | --- |
| `DATABASE_URL` | Supabase transaction-pooler URL (port 6543), Mumbai region |
| `SESSION_SECRET` | signing the session cookie and hashing OTPs (32+ random chars) |
| `MSG91_AUTH_KEY`, `MSG91_SMS_TEMPLATE_ID` | SMS codes (DLT-approved OTP template) |
| `MSG91_WHATSAPP_NUMBER`, `MSG91_WHATSAPP_TEMPLATE`, `MSG91_WHATSAPP_NAMESPACE` | WhatsApp codes (approved authentication template) |
| `OTP_TEST_MODE` | dev only, default `false` |

## Supabase setup

1. Create a project in region `ap-south-1` (Mumbai).
2. Put its transaction-pooler connection string in `DATABASE_URL`.
3. `npm run db:migrate && npm run db:seed`.
4. Optional: schedule cleanup with pg_cron: `select cron.schedule('myniyam-sweep', '*/15 * * * *', 'select private.sweep()');`
