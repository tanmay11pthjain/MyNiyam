# Setting up Supabase and MSG91 for MyNiyam

Every value goes into `app/.env.local` (copy it from `app/.env.example`). That file is git-ignored. Never paste these values into code, chat or a commit.

Screen and menu names in both dashboards change from time to time. If a label below doesn't match exactly, look for the closest one.

---

## Part A: Supabase (the database)

About 10 minutes.

1. Go to https://supabase.com and sign in. GitHub sign-in is fine.
2. Click **New project**.
   - **Name:** `myniyam`
   - **Database password:** click **Generate a password** and save it in your password manager. You need it in step 5.
   - **Region:** **South Asia (Mumbai)**, which is `ap-south-1`.
   - **Plan:** Free is enough to start.
3. Click **Create new project** and wait 1 to 2 minutes until the dashboard is ready.
4. Click **Connect** at the top of the project page. Under **Connection string**, pick **Transaction pooler**: the URI that uses port **6543**. Copy it. It looks like
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`
5. Replace `[YOUR-PASSWORD]` with the password from step 2.
   If the password has symbols such as `@ # / ? %`, either generate a new one with only letters and numbers (**Project Settings → Database → Reset database password**), or URL-encode the symbols. For example, `@` becomes `%40`.
6. In `app/.env.local`, set:
   ```
   DATABASE_URL=<the string from step 5>
   ```
7. Create the tables and add the HEER01 pathshala. In a terminal, inside `app/`:
   ```
   npm run db:migrate
   npm run db:seed
   ```
   You should see `applied 20261020000001_onboarding.sql` and `ran supabase/seed.sql`.
   Do **not** run `db:seed:dev` on Supabase. It adds demo pathshalas and is for your computer only.
   If `db:migrate` fails with a connection or "prepared statement" error, try once with the **Session pooler** string (port 5432) from the same Connect screen.
8. Check it worked. In Supabase, open **Table Editor → sanghs**. You should see **Shree Heer Jain Pathshala** with code **HEER01**. Then open **classes** and check there are 4 rows.
9. Optional, but good for later: in **Database → Extensions**, turn on `pg_cron`. Then in **SQL Editor**, run:
   ```sql
   select cron.schedule('myniyam-sweep', '*/15 * * * *', 'select private.sweep()');
   ```
   This deletes expired codes every 15 minutes.

You don't need Supabase's API keys (anon or service_role). The app talks to the database directly from the server.

---

## Part B: the session secret

In a terminal, run:
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```
Put the output in `app/.env.local`:
```
SESSION_SECRET=<the output>
```

---

## Part C: MSG91 (codes by SMS and WhatsApp)

SMS in India needs DLT registration. That is a government rule, not an MSG91 one, and approvals can take a few days. Start it first. WhatsApp needs Meta approval, which also takes a day or two. Until both are approved, keep `OTP_TEST_MODE=true` on your computer.

### C1. Auth key (5 minutes)

1. Sign in at https://control.msg91.com.
2. Open your account menu (top right) → **Authkey** (sometimes under **API**). Click **Create Authkey** and name it `myniyam-server`.
3. If MSG91 asks about IP whitelisting, you can leave it off for now. Turn it on later with your server's IP.
4. Copy the key into `app/.env.local`:
   ```
   MSG91_AUTH_KEY=<key>
   ```
5. Add some money to the MSG91 wallet. Messages are prepaid.

### C2. DLT registration for SMS (one time, a few days)

1. Register as a **Principal Entity** on one DLT portal, for example Jio (trueconnect.jio.com) or Vodafone Idea (vilpower.in). You get one **Entity ID**, and it works on every network.
2. Register a **Header** (sender ID): 6 letters, for example `MYNIYM`. Type: Transactional or Service Implicit.
3. Register a **Content Template** of type **Service Implicit** (OTP), with exactly one variable. For example:
   ```
   {#var#} is your MyNiyam code. It works for 5 minutes. Do not share it with anyone.
   ```
   Wait for approval, then note the **DLT Template ID**.

### C3. SMS template in MSG91

1. In MSG91, add your **Entity ID** and **Sender ID** (header) in the SMS / DLT settings.
2. Go to the **OTP** section → **Templates** → **Create template**.
   - Paste the same text as the approved DLT template, but put `##OTP##` where `{#var#}` is.
   - Enter the **DLT Template ID** and pick your sender ID.
3. Save it, then copy **MSG91's own template ID** (not the DLT one) into `app/.env.local`:
   ```
   MSG91_SMS_TEMPLATE_ID=<MSG91 template id>
   ```

### C4. WhatsApp (one time, 1 to 2 days)

1. You need a **Meta (Facebook) Business** account, and a phone number that is **not** already used in the WhatsApp app.
2. In MSG91, open **WhatsApp** → **Add / Integrate number**. Follow Meta's sign-up pop-up: pick your business, add the number, verify it with the code Meta sends, and set the display name (for example "MyNiyam").
3. Create a template in MSG91 → WhatsApp → **Templates**:
   - **Category:** **Authentication**
   - **Language:** English
   - **Name:** for example `myniyam_otp`
   - Body: the standard authentication text with the code as `{{1}}`
   - Button: **Copy code**
   Submit it and wait for Meta's approval.
4. Fill in `app/.env.local`:
   ```
   MSG91_WHATSAPP_NUMBER=91XXXXXXXXXX      # the integrated number, with 91, no + or spaces
   MSG91_WHATSAPP_TEMPLATE=myniyam_otp
   MSG91_WHATSAPP_NAMESPACE=<namespace>    # shown in the template's details; leave empty if there is none
   MSG91_WHATSAPP_LANGUAGE=en
   ```

If only SMS is ready, leave the WhatsApp lines empty. The app then sends by SMS and the screen says SMS.

---

## Part D: switch it on and test

1. In `app/.env.local`, set `OTP_TEST_MODE=false`.
2. Restart the app: stop `npm run dev` and start it again.
3. Open http://localhost:3100/j/HEER01, enter **your own** number, and check that the code arrives and works.
4. If it doesn't arrive, the terminal shows a line with `otp_delivery_failed` and MSG91's reason. Send me that line, but not your keys.

Your finished `app/.env.local` should have values for:
`DATABASE_URL`, `SESSION_SECRET`, `MSG91_AUTH_KEY`, `MSG91_SMS_TEMPLATE_ID`, the four `MSG91_WHATSAPP_*` lines (optional), and `OTP_TEST_MODE=false`.
