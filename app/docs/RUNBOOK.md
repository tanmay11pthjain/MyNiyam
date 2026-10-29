# If something breaks

Short and in order. Start at the top.

1. **Is the site up?** Open https://myniyam.vercel.app/healthz.
   - `"ok":true` means the app and database are fine. Read the other lines: anything that says
     `MISSING` is a setting to add in Vercel (Settings > Environment Variables), then Redeploy.
   - `"schema"` says `BEHIND`: the app is newer than the database, so most screens show "Something went
     wrong on our side". Run `npm run db:migrate` against Supabase (SETUP.md, top of the file).
   - `"db":"down"` or no answer: check Supabase (project paused? over the free limit?) and Vercel
     (Deployments: is the latest one Ready?).
2. **A bad deploy.** In Vercel > Deployments, open the last good one and choose "Promote to
   Production". This rolls back the code in a minute. The database is not rolled back.
3. **Nobody gets login codes.** `/healthz` should show `"otp":"sms"`. Check MSG91 balance and the
   DLT template. Short-term: set `OTP_DELIVERY=simulate` and `ALLOW_OTP_SIMULATION_IN_PRODUCTION=true`
   only with `DEMO_PHONES` set (then only those numbers can log in).
4. **Reminders stopped.** In Supabase SQL: `select * from cron.job_run_details order by start_time desc limit 5;`
   and `select status_code, content from net._http_response order by id desc limit 5;`. A 401 means
   CRON_SECRET in the job and in Vercel differ.
5. **Errors.** With `SENTRY_DSN` set, Sentry emails each new error. Without it, Vercel > Logs, filter
   `"level":"error"`. Every error has a requestId the member can read out from the screen.
6. **A member's data looks wrong.** Admin panel > Members > the person. Logs older than the
   log window can't be changed by members; that is on purpose.

Turn a P3 feature off without a deploy: the class board is per class (Setup > Classes); goals can be
deleted (Goals and challenges); reminders stop if you remove `VAPID_PRIVATE_KEY` in Vercel.
