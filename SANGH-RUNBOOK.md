# Adding / removing a Sangh (Pathshala)

There is no in-app UI for this — it's deliberate. `sanghs/` has `".write": false` in
`firebase-rules.json` (no client, not even an admin, can write it), and `users/{uid}/sanghCodes`
(which sangh(s) an admin manages) has `".validate": false` for the same reason. Both are managed
here, in the Firebase Console.

The app protects the one thing that used to make this risky: if a member's sangh disappears, they
are automatically asked to pick a new one next time they open the app (see
`_promptSanghReselectIfOrphaned()` in `app.js`) — their account, history, AP, streak and badges are
all untouched. So removal below needs no manual member reassignment.

## Add a Sangh

1. Firebase Console → Realtime Database → `sanghs` → add a child:
   ```
   {CODE}: { "name": "Sangh Name", "city": "City" }
   ```
2. To give it an admin, add `{CODE}` to that admin's `users/{their uid}/sanghCodes` array
   (create the array if it doesn't exist).
3. That's it — members can now select `{CODE}` at registration, and `sangh_settings/{CODE}` is
   created automatically the first time that admin saves Settings. Nothing to pre-create there.

## Remove a Sangh

1. Delete `sanghs/{CODE}`.
2. Clean up what was scoped by it:
   - `sangh_users/{CODE}` (the member index)
   - `sangh_settings/{CODE}` (niyam toggles, point overrides, attendance-taken dates)
   - Remove `{CODE}` from every admin's `sanghCodes` array who had it
3. Done. You do **not** need to touch individual members' `registration.sanghCode` — each one is
   prompted to pick a replacement automatically on next load.

## Two things to know afterward

- **The landing page's sangh count** (`stats.sanghs`) refreshes the next time any admin opens the
  Leaderboard tab (`_updatePublicStats()`) — it won't update itself instantly.
- **A member who picks a new sangh is re-scored at that sangh's point values** on their next load
  (the same `pointsVersion` recompute that already runs whenever an admin edits points) — expect
  their AP to reflect the new sangh's rates going forward, not the old one's.
