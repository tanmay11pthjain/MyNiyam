// ============================================================
// MyNiyam — ONE-TIME Sheet → Firebase migration
//
// Run this ONCE, pasted into the browser's DevTools console, while signed in
// as ADMIN on the live app (so `Auth` and `firebase` are already loaded and
// you're authenticated as admin — required for steps 3/4 below).
//
// Safe to re-run: every step skips whatever it already migrated.
//
// WHAT THIS DOES NOT DO: it cannot write the `sanghs` node for you — that
// path is deliberately console-only (no client, not even an admin, can
// write it — see firebase-rules.json). Instead, step 1 prints ready-to-paste
// JSON. Copy it into: Firebase console → Realtime Database → the `sanghs`
// row → "⋮" menu → Import JSON.
//
// RUN THIS BEFORE (or immediately after) deploying the new firebase-rules.json.
// fetchSanghs() has a transitional fallback to the Sheet, so registration
// keeps working either way — but the sooner sanghs/ is populated, the
// sooner that fallback stops being needed.
// ============================================================

(async () => {
  const db = firebase.database();
  const log = (...args) => console.log('%c[migrate]', 'color:#E8722A;font-weight:bold', ...args);

  // ----- 1. Sanghs -----
  log('Fetching sanghs from the Sheet...');
  const sanghsList = await Auth.fetchSanghsFromSheetLegacy();
  const sanghsJson = {};
  sanghsList.forEach(s => { sanghsJson[s.code] = { name: s.name, city: s.city }; });
  console.log(
    '%c[migrate] Paste this at the "sanghs" node in the Firebase console (⋮ → Import JSON):',
    'color:#E8722A;font-weight:bold'
  );
  console.log(JSON.stringify(sanghsJson, null, 2));
  log(`${sanghsList.length} sangh(s) found.`);

  // ----- 2. sangh_users — backfills the index for anyone who registered
  // before it existed. This path is client-writable for any signed-in user,
  // so no admin check needed here specifically (though you should still be
  // signed in as admin for steps 3/4 below).
  if (sanghsList.length > 0) {
    log('Backfilling sangh_users/ ...');
    const allCodes = sanghsList.map(s => s.code);
    const sheetUsers = await Auth.fetchSanghUsersFromSheetLegacy(allCodes);
    let written = 0;
    for (const u of sheetUsers) {
      if (!u.uid || !u.sanghCode) continue;
      await db.ref(`sangh_users/${u.sanghCode}/${u.uid}`).set(true);
      written++;
    }
    log(`sangh_users/ backfilled for ${written} user(s).`);
  } else {
    log('No sanghs found — skipping sangh_users backfill.');
  }

  // ----- 3. Photos — copies every registered user's Sheet photo into
  // users/{uid}/photo. Skips anyone who already has one, so a second run
  // only picks up users that failed or were added since the last run.
  log('Fetching the user list...');
  const usersSnap = await db.ref('users').once('value');
  const allUsers = usersSnap.val() || {};
  const uids = Object.keys(allUsers);
  log(`${uids.length} user(s) found. Copying photos (this can take a while)...`);
  let photosCopied = 0, photosSkipped = 0, photosNone = 0;
  for (const uid of uids) {
    if (allUsers[uid] && allUsers[uid].photo) { photosSkipped++; continue; }
    const photo = await Auth.fetchPhotoFromSheetLegacy(uid);
    if (photo) {
      await db.ref(`users/${uid}/photo`).set(photo);
      photosCopied++;
    } else {
      photosNone++;
    }
  }
  log(`Photos: ${photosCopied} copied, ${photosSkipped} already present, ${photosNone} had none in the Sheet.`);

  // ----- 4. Stats — same computation app.js's _updatePublicStats() does on
  // every admin login; run once now so the landing page isn't blank until
  // an admin next opens the Leaderboard tab.
  let userCount = 0;
  Object.values(allUsers).forEach(data => { if (data && data.role !== 'admin') userCount++; });
  await db.ref('stats').set({ users: userCount, sanghs: sanghsList.length });
  log(`stats/ written: ${userCount} users, ${sanghsList.length} sanghs.`);

  log('Done! Remember to paste the sanghs JSON above into the Firebase console.');
})();
