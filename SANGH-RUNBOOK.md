# Managing a Sangh (Pathshala) — v5

There is no in-app UI for adding/removing a sangh or granting admin rights — it's deliberate.
`sanghs/` has `".write": false` in `firebase-rules.json` (no client, not even an admin, can write
it), `users/{uid}/sanghCodes` has `".validate": false`, and `sangh_config/{code}/admins` has
`".write": false`. All three are managed here, in the Firebase Console.

The app protects the one thing that used to make this risky: if a member's sangh disappears, they
are automatically asked to pick a new one next time they open the app (see
`_promptSanghReselectIfOrphaned()` in `app.js`) — their account, history, AP, streak and badges are
all untouched.

## Sangh code format

`MN` followed by 4 digits (e.g. `MN0004`). Nothing in the code enforces this — `sanghs/` is
console-only, so there is no client-side validation to enforce it against — but keeping every new
code to this shape avoids the exact bug v5's reset cleaned up: `MN004` and `MN0004` existing as two
different, unrelated codes because nothing caught the inconsistency.

## Add a Sangh

1. Firebase Console → Realtime Database → `sanghs` → add a child:
   ```
   {CODE}: { "name": "Sangh Name", "city": "City", "active": true }
   ```
2. Create its config node — `sangh_config/{CODE}`:
   ```
   { "settings": { ... }, "points": {}, "pointsVersion": 0 }
   ```
   `settings` needs every `enable<Id>` flag from the current `NIYAM_REGISTRY` (data.js). Don't
   hand-type it — run `node seed-v5.js` in the project directory and copy the `settings` object out
   of its output (it derives the flag list from the live registry, so it can never miss a niyam or
   include a removed one). Leave `points: {}` (every niyam scores its coded default) unless you want
   this sangh's point values explicit in the database from day one.
3. To give an admin access to it, see **Provision an Admin** below.
4. That's it — members can now select `{CODE}` at registration. `sangh_members/{CODE}` and
   `sangh_attendance/{CODE}` are created automatically on first use; nothing to pre-create there.

## Remove a Sangh

1. Delete `sanghs/{CODE}`.
2. Clean up what was scoped by it:
   - `sangh_members/{CODE}` (the member index)
   - `sangh_config/{CODE}` (niyam toggles, point overrides)
   - `sangh_attendance/{CODE}` (attendance history)
   - Remove `{CODE}` from every admin's `sanghCodes` array who had it
3. Done. You do **not** need to touch individual members' `registration.sanghCode` — each one is
   prompted to pick a replacement automatically on next load.

## Provision an Admin

Admins are granted by hand, in two places that must both be set — one is what the *app* reads to
show admin screens, the other is what the *security rules* read to let the admin's writes through.
Setting only one leaves an admin UI whose every save is denied.

1. Have the person sign in with Google at least once. This mints their Firebase Auth UID — you
   can't provision an admin before their account exists.
2. Firebase Console → Authentication → Users → find their row → copy the **User UID**.
3. Realtime Database → `users/{their UID}` → set (create if absent):
   ```
   { "name": "Their Name", "role": "admin", "sanghCodes": ["{CODE}", ...] }
   ```
   Admins never have a `registration` node — that's how the app tells an admin profile apart from a
   member one (see `auth.js`'s `fetchProfiles()`). `sanghCodes` is the FULL list of sanghs this
   admin manages; a multi-sangh admin lists every code here.
4. For **each** code in that list, Realtime Database → `sangh_config/{CODE}/admins/{their UID}` →
   set to `true`. This is the one the security rules actually check — `sanghCodes` above is only
   what the app UI reads to know which sanghs to show.
5. Have them reload the app. They should land on the admin dashboard.

**A residual, accepted limitation:** the rules check is keyed by the signed-in Google account (the
Firebase Auth base UID), not by which of that account's `__p2`..`__p5` family profile slots is
active. If a parent's account is an admin and their child occupies another slot on the *same*
account, the child's session carries admin write rights at the database level — the app's UI keeps
them out of the admin screens, but the rules cannot tell the two profiles apart (the active profile
lives only in the browser's local storage, never reaches Firebase). Don't share an admin account
with a child's own profile slot; give the child their own separate Google sign-in instead.

## Two things to know afterward

- **The landing page's sangh count** (`stats.sanghs`) refreshes the next time any admin opens the
  Leaderboard tab (`_updatePublicStats()`) — it won't update itself instantly.
- **A member who picks a new sangh is re-scored at that sangh's point values** on their next load
  (the same `pointsVersion` recompute that already runs whenever an admin edits points) — expect
  their AP to reflect the new sangh's rates going forward, not the old one's.

## What changed from v4

v5 replaced three v4 nodes with four narrower ones, closing a database-wide read that let any
signed-in account see every member's personal data (name, date of birth, phone, photo, full daily
history), and moving profile photos out of the database into Firebase Storage:

| v4 | v5 | Why |
|---|---|---|
| `sangh_users/{code}` | `sangh_members/{code}` | same idea, but now write-scoped to that sangh's own admins (v4 let *any* signed-in user write it) |
| `sangh_settings/{code}` | `sangh_config/{code}` + `sangh_attendance/{code}` | v4 mixed slow-changing config with an ever-growing attendance log on one node every member listened to live — an admin editing a point value re-downloaded the whole attendance history to every member. Split apart, plus a new `admins/{baseUid}` child the security rules use to scope admin writes per-sangh (v4 let any admin write any sangh) |
| `users/{uid}/photo` (inline base64, ~30-90KB/member) | `users/{uid}/photoUrl` (a short string) + the actual image in Firebase Storage | kept every whole-record read of a member small; see `storage-rules.txt` |
| a legacy global `settings` node | *(removed)* | was a stale fallback layer that could silently override a sangh's own saved choices for any niyam it hadn't explicitly re-saved; v5 seeds every sangh's flags explicit instead |
| `users` readable by any signed-in account | `users/$uid` readable only by that member, their own family profiles, or an admin of *their specific* sangh | the core privacy fix — see `firebase-rules.json` |

There is no migration script from v4 to v5 — the switch was a full database reset (see the project's
migration plan). `seed-v5.js` generates a fresh sangh's starting config from the live niyam registry.
