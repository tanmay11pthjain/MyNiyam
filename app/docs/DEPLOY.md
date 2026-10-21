# Put MyNiyam online for the team demo

Three parts, in this order: the live database, GitHub, then Vercel. About 30 minutes.

Login codes stay **simulated** (always 1234), but only for the demo numbers below. Any other number gets "This is a demo. Only the demo numbers can log in." So nobody can log in as a real member with 1234.

| Who | Number | Where to log in |
| --- | --- | --- |
| Admin1 (admin of HEER01) | 99999 00001 | `/admin/login` |
| User1 (a member of HEER01) | 70000 00001 | `/login` |

The code is always **1234**.

---

## Part 1: the live database (Supabase)

Your `app/.env.local` already points `DATABASE_URL` at Supabase, so these commands run on the live database.

1. Open a terminal and go into the app folder:
   ```
   cd C:\Users\tanma\Desktop\MyNiyam\app
   ```
2. Bring the tables up to date:
   ```
   npm run db:migrate
   ```
   You should see `applied 20261022000001_log_delete_window.sql` (and any other new file), then `migrations up to date`.
3. Make sure HEER01 and its classes are there. It is safe to run again:
   ```
   npm run db:seed
   ```
4. Add the demo accounts:
   ```
   npm run db:seed:demo
   ```
   You should see `ran supabase/seed.demo.sql`. Running it a second time changes nothing.
   It adds Admin1 as a HEER01 admin, User1 with 14 days of history, and five starter niyams **only if HEER01 has no niyams yet**.
5. Check in Supabase: **Table Editor → profiles** shows User1.

Do **not** run `db:seed:dev` or `db:reset` on Supabase.

---

## Part 2: GitHub (your existing repo)

The code goes into your existing repo, https://github.com/tanmay11pthjain/MyNiyam. The old v5 app has been **removed** from it: after this push the repo holds only the new app (in the `app` folder). The v5 files still exist in the repo's history, so they can be brought back if ever needed.

1. In the terminal, go to the project folder:
   ```
   cd C:\Users\tanma\Desktop\MyNiyam
   ```
2. Push:
   ```
   git push -u origin main
   ```
   If Git asks you to sign in, use the browser window it opens. Never use `--force`.
3. Refresh the GitHub page. You should see `app`, `landing` and a few notes, and none of the v5 files.

`app/.env.local` is git-ignored, so your passwords and keys are not uploaded.

If v5 was already on Vercel from this repo, that site will stop working after the push, because its files are gone. Part 3 points that same Vercel project at the new app, so it keeps the same address.

---

## Part 3: Vercel

**If v5 is already on Vercel from this repo** (most likely), reuse that project so the address stays the same:

1. Go to https://vercel.com, open the MyNiyam project, then **Settings → Build and Deployment** (sometimes called **General**).
2. **Root Directory:** set it to `app` and save.
3. **Framework Preset:** set it to **Next.js** and save. Leave the build and output commands on their defaults.
4. Go to **Settings → Environment Variables** and add the variables in the table below (step 5 below shows how to make `SESSION_SECRET`). Delete any old v5 variables (for example Firebase keys) that the new app does not use.
5. Go to **Deployments**, open the newest one and click **Redeploy** (or just push again). Then continue at step 7 below.

**If there is no Vercel project yet:**

1. Go to https://vercel.com and **sign in with GitHub**.
2. Click **Add New… → Project**, find `MyNiyam` and click **Import**.
3. Set **Root Directory** to `app`. **Framework Preset:** Next.js.
4. The environment variables (name on the left, value on the right):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the same Supabase string as in `app/.env.local` (the one with port **6543**) |
   | `SESSION_SECRET` | a **new** random value (see step 5) |
   | `OTP_DELIVERY` | `simulate` |
   | `ALLOW_OTP_SIMULATION_IN_PRODUCTION` | `true` |
   | `DEMO_PHONES` | `+919999900001,+917000000001` |
   | `DB_POOL_MAX` | `3` |
   | `SUPABASE_URL` | from `app/.env.local` (needed for logo and photo uploads) |
   | `SUPABASE_SERVICE_ROLE_KEY` | from `app/.env.local` (needed for logo and photo uploads) |

   If you leave the two `SUPABASE_` values out, the demo still works, but uploading a logo or photo will fail.

5. To make the new `SESSION_SECRET`, run this in the terminal and copy the output:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
6. Click **Deploy** and wait for the build to finish (2 to 3 minutes).
7. Vercel shows your address, for example `https://myniyam.vercel.app`. Check it:
   - open `https://<your address>/healthz`. You should see `{"ok":true,"db":"up",...}`.
   - open `https://<your address>/login`, log in with **70000 00001**, code **1234**, and pick User1.
   - open `https://<your address>/admin/login`, log in with **99999 00001**, code **1234**.
8. The footer shows the version and the commit Vercel built, so you can tell which version the team is seeing.

From now on, every `git push` to `main` makes Vercel build and publish the new version by itself.

### Your own super admin login (optional)

`SUPER_ADMIN_PHONE` is left out above on purpose. With simulated codes, anyone who knows the address and your number could log in as super admin with 1234. If you want to show the super admin screen, add `SUPER_ADMIN_PHONE` = your number, **and** add your number to `DEMO_PHONES`, only for the presentation. Then remove both again afterwards.

---

## After the presentation

1. Remove the demo accounts from the live database (from the `app` folder):
   ```
   npm run db:demo:remove
   ```
2. Before real members join, switch to real login codes: follow [SETUP.md](SETUP.md) Part C and D, then in Vercel set `OTP_DELIVERY=msg91` and delete `ALLOW_OTP_SIMULATION_IN_PRODUCTION` and `DEMO_PHONES`. Then click **Redeploy**.
3. Turn on the cleanup job in Supabase ([SETUP.md](SETUP.md) Part A, step 9).

## If something goes wrong

- **Build fails on Vercel:** check that Root Directory is `app`. The build log names the first error.
- **The site shows "Something went wrong":** in Vercel open **Logs**. A line saying `Bad or missing environment variables` names the missing one.
- **`/healthz` says the database is down:** check that `DATABASE_URL` uses port **6543** and has the right password.
