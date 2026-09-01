// ===== MyNiyam V5 — Firebase Google Auth + Firebase-backed Identity =====
// Firebase Realtime Database is the sole master for everything the app
// reads, scoped by firebase-rules.json to each member's own record and
// their sangh's admins. Profile photos live in Firebase Storage
// (storage-rules.txt), not inline in the database — see uploadPhoto()/
// fetchPhotoUrl() below. The Sheet (via Apps Script — see
// apps-script-additions.gs) is still written to on registration/profile
// changes as a human-readable mirror, but the app itself never reads from
// it. There is no migration script — v5 shipped via a full database reset
// (see SANGH-RUNBOOK.md), so the old *FromSheetLegacy() readers that only
// existed for that one-time migration have been removed.

const Auth = (() => {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbysnFVeHYnOj9yqZzXCtBV2KQfStNV8GMe-ABHPxM4a7GA16yWziTkqM3ouyHb2wEMp/exec";

  let currentUser = null;
  let authListeners = [];
  let _unsubFirebase = null;
  // False until Firebase's onAuthStateChanged fires for the first time (it
  // always fires at least once on load, with either a restored user or
  // null). app.js uses this to tell "genuinely signed out" apart from
  // "Firebase hasn't answered yet" while a returning session is booting.
  let _firebaseAuthResolved = false;

  // ===== MULTI-PROFILE IDENTITY =====
  // One Google account can have up to MAX_PROFILES separate MyNiyam members
  // (e.g. a parent + children). The Google UID is the "base" account; a
  // profile's app-facing "uid" — the SAME key every Firebase path and Sheet
  // row already uses — is either the bare base uid (the primary/slot 1) or
  // "{baseUid}__pN" (slot 2-5). Keeping the primary's id unchanged is what
  // makes this feature need zero migration: every existing user's data is
  // already keyed by their bare uid. Must stay in sync with
  // handleGetProfiles() in apps-script-additions.gs.
  const PROFILE_SEP = '__p';
  const MAX_PROFILES = 5;

  function _activeProfileStorageKey(baseUid) {
    return `myniyam_active_profile_${baseUid}`;
  }

  // Recovers the base (Google) uid from any profile id, primary or not.
  function baseUidOf(profileId) {
    const idx = String(profileId || '').indexOf(PROFILE_SEP);
    return idx === -1 ? profileId : profileId.slice(0, idx);
  }

  // Purely local/synchronous — no network round-trip — so resolving which
  // profile is active never slows down the login critical path. Can point
  // at a profile that no longer exists in the Sheet (e.g. an admin removed
  // it, or an "Add Profile" attempt was abandoned before registering);
  // app.js's _loadAccountProfiles() detects that once the real list arrives
  // and self-heals by falling back to the primary and reloading once.
  function getActiveProfileId(baseUid) {
    try {
      const stored = localStorage.getItem(_activeProfileStorageKey(baseUid));
      if (stored) return stored;
    } catch (e) { /* localStorage unavailable — default to primary */ }
    return baseUid;
  }

  function setActiveProfile(baseUid, profileId) {
    try {
      localStorage.setItem(_activeProfileStorageKey(baseUid), profileId);
    } catch (e) { /* unavailable — non-fatal, next load just defaults to primary */ }
  }

  // Returns the lowest free profile slot id for this account (up to
  // MAX_PROFILES), or null once all slots are taken. The one place the
  // slot->id mapping is computed, so it can never drift from baseUidOf()/
  // the primary-vs-added distinction used everywhere else.
  function getNextProfileId(baseUid, existingProfiles) {
    const taken = new Set((existingProfiles || []).map(p => p.profileId));
    for (let slot = 1; slot <= MAX_PROFILES; slot++) {
      const id = slot === 1 ? baseUid : `${baseUid}${PROFILE_SEP}${slot}`;
      if (!taken.has(id)) return id;
    }
    return null;
  }

  // Lists every profile under one Google account — Firebase is master.
  // A profile "exists" iff users/{id}/registration is present, checked for
  // all MAX_PROFILES possible slot ids in parallel (never more than 5 reads,
  // over the same already-open connection auth used — no round-trip cost
  // per slot the way a separate HTTP request would have). Returns null on
  // ANY failure — callers must treat that as "unknown", never as "this
  // account has just one profile". A brand-new account with zero registered
  // slots is still a genuine, successful answer (not a failure), so THAT
  // case gets a primary placeholder rather than null — same contract this
  // function has always had, just answered from a different source.
  async function fetchProfiles(baseUid) {
    try {
      const db = firebase.database();
      const slotIds = [baseUid];
      for (let slot = 2; slot <= MAX_PROFILES; slot++) slotIds.push(`${baseUid}${PROFILE_SEP}${slot}`);

      // Three leaf reads per slot instead of one: "has a registration" is NOT
      // the same as "is a profile" for an admin. Admins are provisioned
      // console-side and their user record only ever carries `role` and
      // `name` (app.js writes the latter on every admin login) — never a
      // `registration` node. Judging by registration alone made an admin's
      // OWN slot invisible in their own profile list, which broke
      // getNextProfileId() (handed back the id already in use) and made
      // app.js's "active profile vanished" self-heal fire against a profile
      // that never went anywhere. All 15 reads are dispatched in one
      // parallel batch over the already-open connection — still one round
      // trip, not fifteen.
      const [regSnaps, roleSnaps, nameSnaps] = await Promise.all([
        Promise.all(slotIds.map(id => db.ref(`users/${id}/registration`).once('value'))),
        Promise.all(slotIds.map(id => db.ref(`users/${id}/role`).once('value'))),
        Promise.all(slotIds.map(id => db.ref(`users/${id}/name`).once('value')))
      ]);

      const profiles = [];
      slotIds.forEach((id, i) => {
        const reg = regSnaps[i].val();
        const isAdmin = roleSnaps[i].val() === 'admin';
        if (!reg && !isAdmin) return; // genuinely empty slot — not a profile yet
        profiles.push({
          profileId: id,
          // An admin has no registration to take a name from; users/{id}/name
          // is the only name their record carries.
          name: String((reg && reg.name) || nameSnaps[i].val() || '').trim(),
          sanghCode: String((reg && reg.sanghCode) || '').trim(),
          // Still means exactly one thing — "this slot has a member
          // registration" — which is why the admin case gets its OWN flag
          // below rather than being folded in here and blurring both.
          registered: !!reg,
          isAdmin: isAdmin
        });
      });

      return profiles.length > 0
        ? profiles
        : [{ profileId: baseUid, name: '', sanghCode: '', registered: false, isAdmin: false }];
    } catch (e) {
      // A genuine failure. Returning null (not a fabricated single-profile
      // list) is what stops app.js's _loadAccountProfiles() from treating a
      // failed request as authoritative — feeding it a fallback that looks
      // identical to a real "just the primary" account is what silently
      // bounced a newly added, not-yet-registered profile back to the primary.
      console.error("Fetch profiles from Firebase failed:", e);
      return null;
    }
  }

  // ===== SHEETS TRANSPORT (fetch, with a JSONP fallback for CORS failures) =====
  // Apps Script only sends Access-Control-Allow-Origin when the deployment's
  // "Who has access" is set to Anyone; any stricter setting makes every fetch()
  // reject with a CORS TypeError. JSONP sidesteps CORS entirely (a <script> tag
  // is not subject to the same-origin policy), so it's the fallback here rather
  // than a second fetch variant. Returns the raw response text either way —
  // callers keep their existing JSON.parse + fallback handling unchanged.
  // `opts.allowJsonp` (default true) lets a caller opt OUT of the JSONP
  // fallback. _fetchViaJsonp encodes the whole payload into a URL query
  // string, which cannot carry a ~20KB base64 photo — so photo requests pass
  // false and a transport failure surfaces as a real, visible error instead
  // of silently attempting a request that could never have worked.
  async function _sheetsRequest(payload, opts) {
    const allowJsonp = !opts || opts.allowJsonp !== false;
    try {
      return await _fetchViaPost(payload);
    } catch (e) {
      if (!allowJsonp) throw e;
      console.warn("Direct fetch to Apps Script failed (likely CORS) — retrying via JSONP:", e);
      return _fetchViaJsonp(payload);
    }
  }

  async function _fetchViaPost(payload) {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow"
    });
    return response.text();
  }

  let _jsonpCounter = 0;
  function _fetchViaJsonp(payload) {
    return new Promise((resolve, reject) => {
      const cbName = `__myniyam_cb_${Date.now()}_${_jsonpCounter++}`;
      const script = document.createElement('script');
      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('JSONP request to Apps Script timed out'));
      }, 15000);

      window[cbName] = (data) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(JSON.stringify(data));
      };

      script.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('JSONP script load failed'));
      };

      script.src = `${APPS_SCRIPT_URL}?callback=${cbName}&payload=${encodeURIComponent(JSON.stringify(payload))}`;
      document.body.appendChild(script);
    });
  }

  // ===== GOOGLE SIGN IN =====
  async function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      const result = await firebase.auth().signInWithPopup(provider);
      // The auth state listener will handle the rest
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== SIGN OUT =====
  async function signOut() {
    try {
      await firebase.auth().signOut();
    } catch (e) {
      console.error("Sign out error:", e);
    }
    currentUser = null;
    localStorage.removeItem('myniyam_session');
    _notifyListeners();
  }

  // ===== IDENTITY — resolved from Firebase, not Sheets =====
  // role/sanghCodes/registered used to come from an Apps Script round trip
  // (google_login) on EVERY login — a 302-redirecting, occasionally
  // cold-starting call that was the single biggest contributor to a slow
  // load. Firebase already mirrors everything needed:
  //   - users/{uid}/role       — written on every login for as long as this
  //                              app has existed (see app.js's init()), so
  //                              every returning user already has it
  //   - users/{uid}/sanghCodes — NEW; console-managed (there is no in-app
  //                              admin-role UI). Absent for an admin means
  //                              "not yet backfilled", not "no sanghs" — see
  //                              the fallback below and firebase-rules.json.
  //   - users/{uid}/registration / registered — already written at
  //                              registration (handleRegistration())
  // Reads each field at its own path (not the whole users/{uid} node) —
  // that node also holds the user's entire daily_logs history, and pulling
  // all of it just to read four small fields would be slower than the
  // Sheets call this replaces, not faster.
  //
  // Single attempt. Returns the resolved shape on success, or null on ANY
  // failure — same contract _tryFetchRoleFromSheets always had, so
  // _fetchRoleFromFirebase's retry wrapper below can treat the two
  // identically.
  async function _tryFetchIdentityFromFirebase(uid) {
    try {
      const db = firebase.database();
      const [roleSnap, sanghCodesSnap, registrationSnap, registeredSnap] = await Promise.all([
        db.ref(`users/${uid}/role`).once('value'),
        db.ref(`users/${uid}/sanghCodes`).once('value'),
        db.ref(`users/${uid}/registration`).once('value'),
        db.ref(`users/${uid}/registered`).once('value'),
      ]);

      const role = roleSnap.val() === 'admin' ? 'admin' : 'user';
      const registration = registrationSnap.val() || null;

      let sanghCodes = sanghCodesSnap.val();
      if (!Array.isArray(sanghCodes) || sanghCodes.length === 0) {
        // Matches the Sheet's own old fallback (handleGoogleLogin: sanghCodes
        // defaults to [sanghCode] when the explicit list is empty) — an
        // ordinary user only ever has their own single code anyway, so this
        // needs no backfill; only an admin managing several sanghs does.
        sanghCodes = (registration && registration.sanghCode) ? [registration.sanghCode] : [];
      }

      // Trusts the explicit boolean (set at registration) but also accepts a
      // populated registration.name as evidence of being registered, as a
      // safety net for any record from before that boolean field existed —
      // getting this wrong in the "not registered" direction would route an
      // already-registered user into the registration form, which would
      // overwrite their real data on submit.
      const registered = registeredSnap.val() === true || !!(registration && registration.name);

      return { role, sanghCodes, registered, profile: registration };
    } catch (e) {
      console.error("Firebase identity fetch failed:", e);
      return null;
    }
  }

  // Retries a few times so a momentary connection blip self-heals instead of
  // being mistaken for "not registered". If every attempt fails, resolves
  // registered: undefined — NEVER false — for exactly the same reason
  // _fetchRoleFromSheets always did: init() (app.js) treats undefined as
  // "don't decide yet, keep waiting", leaving an inconclusive lookup on the
  // loading screen with its retry affordance rather than routing a real user
  // into a destructive registration form.
  async function _fetchRoleFromFirebase(uid) {
    const ATTEMPTS = 3;
    const RETRY_DELAY_MS = 800;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const result = await _tryFetchIdentityFromFirebase(uid);
      if (result) return result;
      if (attempt < ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    console.error(`Firebase identity fetch failed after ${ATTEMPTS} attempts — leaving registration status undetermined.`);
    return { role: "user", sanghCodes: [], registered: undefined, profile: null };
  }

  // Resolves the active profile's role/registration for a signed-in Firebase
  // user and publishes it as currentUser. Shared by init()'s auth-state
  // listener and retryRoleCheck() (the loading screen's Retry button), so
  // the two can never disagree on how a Firebase user becomes a MyNiyam
  // session.
  async function _resolveAndPublishUser(firebaseUser) {
    const baseUid = firebaseUser.uid;
    // Resolved locally, no network round-trip — see getActiveProfileId().
    const activeProfileId = getActiveProfileId(baseUid);

    // Fetch role and registration status from Firebase — see
    // _tryFetchIdentityFromFirebase's comment for why this replaced the old
    // Sheets round trip. Firebase is now the master for this data outright —
    // there is no Sheet reconciliation step left to run afterwards.
    const { role, sanghCodes, registered, profile } = await _fetchRoleFromFirebase(activeProfileId);

    currentUser = {
      uid: activeProfileId,
      baseUid: baseUid,
      role: role,
      // Prefer the Sheet's registered name for the active profile. Only
      // fall back to the Google account's own display name for the
      // PRIMARY profile before it has registered — exactly the
      // single-profile behavior this app always had. A not-yet-
      // registered ADDED profile must never borrow the Google
      // account's (i.e. the parent's) display name.
      name: (profile && profile.name) || (activeProfileId === baseUid
        ? (firebaseUser.displayName || firebaseUser.email.split('@')[0])
        : ''),
      email: firebaseUser.email,
      photoURL: firebaseUser.photoURL,
      sanghCodes: sanghCodes,
      registered: registered,
      profile: profile
    };

    localStorage.setItem('myniyam_session', JSON.stringify(currentUser));
    _notifyListeners();
  }

  // Manually re-runs the Firebase role/registration check for whichever
  // Firebase user is currently signed in. Bound to the loading screen's
  // Retry button, which only appears if _fetchRoleFromFirebase's own
  // internal attempts all failed. No-op if nobody is signed in (shouldn't
  // happen while the loading screen is up, but defensive regardless).
  async function retryRoleCheck() {
    const firebaseUser = firebase.auth().currentUser;
    if (!firebaseUser) return;
    await _resolveAndPublishUser(firebaseUser);
  }

  // ===== INIT — Start Firebase auth listener =====
  function init() {
    // Check for cached session first for instant UI
    // Strip 'registered' so stale cache doesn't bypass fresh Sheet check
    try {
      const saved = localStorage.getItem('myniyam_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        delete parsed.registered; // force re-check from Sheet
        // Re-resolve which profile is active — the cached session can
        // predate a profile switch (setActiveProfile() writes BEFORE the
        // reload that re-runs this init()), so without this the brief
        // "instant UI" cache could flash the profile just switched away
        // from. A pre-multi-profile cached session has no baseUid at all,
        // so this is a no-op for it — fully backward compatible.
        if (parsed.baseUid) {
          const activeId = getActiveProfileId(parsed.baseUid);
          if (activeId !== parsed.uid) {
            // The cache describes the profile we just switched AWAY from.
            // uid is re-resolvable locally, but role/name/sanghCodes/profile
            // are per-PROFILE facts only _fetchRoleFromFirebase() can answer.
            // Publishing the old role under the new uid is what would let a
            // switch from an admin into a family profile boot the admin
            // panel for an instant — and app.js's admin branch stamps the
            // admin's own cached name onto users/{thatProfile}/name before
            // the real role ever arrives. Dropping these is what makes that
            // branch unreachable until the fresh answer lands (app.js then
            // sits on the loading screen, exactly as it already does for
            // registered === undefined).
            parsed.uid = activeId;
            delete parsed.role;
            delete parsed.name;
            delete parsed.sanghCodes;
            delete parsed.profile;
          }
        }
        currentUser = parsed;
        _notifyListeners();
      }
    } catch (e) { /* ignore */ }

    // Firebase auth state listener
    _unsubFirebase = firebase.auth().onAuthStateChanged(async (firebaseUser) => {
      _firebaseAuthResolved = true;
      if (firebaseUser) {
        await _resolveAndPublishUser(firebaseUser);
      } else {
        // User signed out (or never was) — always notify, even if
        // currentUser was already null. A boot with no cached session still
        // needs this resolution to reach app.js so it can stop waiting and
        // show the login card; silently doing nothing here (the old
        // `if (currentUser)` guard) left a real signed-out visitor stuck
        // once app.js started waiting for a definitive answer.
        const wasSignedIn = !!currentUser;
        currentUser = null;
        if (wasSignedIn) localStorage.removeItem('myniyam_session');
        _notifyListeners();
      }
    });
  }

  // True once Firebase's onAuthStateChanged has fired at least once — see
  // _firebaseAuthResolved above.
  function isAuthResolved() {
    return _firebaseAuthResolved;
  }

  // ===== AUTH STATE LISTENER =====
  function onAuthStateChanged(callback) {
    authListeners.push(callback);
    // Immediately call with current state
    callback(currentUser);
    return () => {
      authListeners = authListeners.filter(cb => cb !== callback);
    };
  }

  function _notifyListeners() {
    authListeners.forEach(cb => cb(currentUser));
  }

  function getCurrentUser() {
    return currentUser;
  }

  let _sanghsCache = null;
  let _sanghsFetchPromise = null;

  // Reads the console-managed sanghs/ node — the single source of truth
  // for the sangh list everywhere in the app (registration, the
  // header/profile labels, the admin poster). No Sheet fallback: sanghs/
  // is fully populated now, and silently substituting stale Sheet data
  // here is exactly what let a rename or a newly-added sangh go unnoticed
  // before. An empty or unreadable node returns an empty list — every
  // caller already handles that (see showRegistrationForm()'s own error
  // message) — rather than ever quietly serving data that isn't actually
  // in the database. Each failure mode below logs its OWN specific cause,
  // so a wrong result is diagnosable from the console alone.
  async function fetchSanghs() {
    // Only a non-empty result is treated as cached — an empty list (e.g. a
    // rules denial, or sanghs/ not populated yet) must not permanently
    // stick for the session; the next call retries.
    if (_sanghsCache && _sanghsCache.length) return _sanghsCache;
    if (_sanghsFetchPromise) return _sanghsFetchPromise;

    _sanghsFetchPromise = (async () => {
      try {
        const snap = await firebase.database().ref('sanghs').once('value');
        const val = snap.val();
        if (val === null || val === undefined) {
          console.error('sanghs/ does not exist in the database yet — see SANGH-RUNBOOK.md to create and populate it.');
          return [];
        }
        if (typeof val !== 'object') {
          console.error(`sanghs/ exists but isn't shaped as an object (got ${typeof val}) — it must be {CODE: {name, city}, ...}.`);
          return [];
        }
        // Normalize every entry to trimmed strings, and drop any with no
        // code.
        const sanghs = Object.keys(val)
          .map(code => ({
            code: String(code || '').trim(),
            name: String((val[code] && val[code].name) || '').trim(),
            city: String((val[code] && val[code].city) || '').trim()
          }))
          .filter(s => s.code);
        if (sanghs.length === 0) {
          console.error('sanghs/ exists but has no valid entries (every child key is the sangh code, and must be non-empty) — check its shape in the Firebase console.');
          return [];
        }
        _sanghsCache = sanghs;
        return sanghs;
      } catch (e) {
        console.error('Failed to read sanghs/ — likely a Firebase rules denial or network error:', e);
        return [];
      }
    })();

    try {
      return await _sanghsFetchPromise;
    } finally {
      _sanghsFetchPromise = null;
    }
  }

  let _statsCache = null;
  let _statsFetchPromise = null;

  // Public, aggregate-only counts for the (signed-out) landing page. Reads
  // the `stats` node, the one Firebase path readable without auth — see
  // firebase-rules.json — kept up to date by app.js whenever an admin loads
  // the panel (see _updatePublicStats()). Mirrors fetchSanghs()'s
  // memoization pattern, and — like before — resolves null (not an empty
  // object) on ANY failure/absence, so the landing page can tell "no data
  // yet" apart from "genuinely zero" and render a dash instead of 0.
  async function fetchStats() {
    if (_statsCache) return _statsCache;
    if (_statsFetchPromise) return _statsFetchPromise;

    _statsFetchPromise = (async () => {
      try {
        const snap = await firebase.database().ref('stats').once('value');
        const val = snap.val();
        if (val) {
          const stats = {
            users: Number(val.users) || 0,
            sanghs: Number(val.sanghs) || 0
          };
          _statsCache = stats;
          return stats;
        }
      } catch (e) {
        console.error("Fetch stats from Firebase failed:", e);
      }
      return null;
    })();

    try {
      return await _statsFetchPromise;
    } finally {
      _statsFetchPromise = null;
    }
  }

  async function sendRegistration(uid, email, regData) {
    try {
      const text = await _sheetsRequest({
        action: "register",
        uid,
        email,
        name: regData.name,
        dob: regData.dob,
        gender: regData.gender || "",
        phone: regData.phone,
        city: regData.city,
        area: regData.area,
        sanghCode: regData.sanghCode || "",
        photo: regData.photo || ""
      }, { allowJsonp: false }); // the photo can be ~20KB — never viable over JSONP's query string
      console.log("Sheets registration response:", text);
    } catch (e) {
      console.error("Registration sheet update failed:", e);
    }
  }

  // Fetch a single user's profile photo URL. Lives at users/{uid}/photoUrl
  // — a short string, not the ~20-90KB base64 blob v4 used to store inline
  // — so it rides along cheaply with the smaller, more frequent reads
  // (_tryFetchIdentityFromFirebase's login-path fetch, renderProfile()'s
  // own registration read) without ever needing to be excluded from them.
  // The actual image lives in Firebase Storage (see uploadPhoto() below)
  // and is fetched by the browser directly from that URL, with normal HTTP
  // caching — never re-downloaded through this database read again.
  async function fetchPhotoUrl(uid) {
    try {
      const snap = await firebase.database().ref(`users/${uid}/photoUrl`).once('value');
      return snap.val() || null;
    } catch (e) {
      console.error("Fetch photo URL from Firebase failed:", e);
      return null;
    }
  }

  // Uploads a resized/compressed data URL to Firebase Storage at
  // profile-photos/{uid}.jpg (see storage-rules.txt — write is restricted
  // to the owning account's own profile slots) and resolves the public
  // download URL. Does NOT write users/{uid}/photoUrl itself — callers
  // write that (a small, fast Realtime Database update) only after this
  // resolves { success: true }, exactly like updateProfile()'s
  // check-before-mirror contract.
  async function uploadPhoto(uid, dataUrl) {
    if (!dataUrl) return { success: false, error: 'no_data' };
    try {
      const ref = firebase.storage().ref(`profile-photos/${uid}.jpg`);
      const snapshot = await ref.putString(dataUrl, 'data_url', { contentType: 'image/jpeg' });
      const url = await snapshot.ref.getDownloadURL();
      return { success: true, url };
    } catch (e) {
      console.error("Photo upload to Storage failed:", e);
      return { success: false, error: (e && e.code) || 'storage_error' };
    }
  }

  // Removes a user's photo object from Storage — called when an admin
  // deletes a member (deleteAdminUser(), app.js), so a removed member's
  // photo doesn't sit in Storage forever with nothing pointing at it.
  // "Nothing there to delete" is treated as success, not a failure.
  async function deletePhoto(uid) {
    try {
      await firebase.storage().ref(`profile-photos/${uid}.jpg`).delete();
      return { success: true };
    } catch (e) {
      if (e && e.code === 'storage/object-not-found') return { success: true };
      console.error("Photo delete from Storage failed:", e);
      return { success: false, error: (e && e.code) || 'storage_error' };
    }
  }

  // Mirrors the photo URL onto the Sheet's own copy, purely for a human
  // browsing the Sheet by hand — the app itself never reads this back.
  // Sends the URL (a short string) rather than the base64 blob v4 sent, so
  // this no longer needs to dodge JSONP's query-string size limit the way
  // the old base64 payload did.
  async function updatePhoto(uid, photoUrl) {
    try {
      const text = await _sheetsRequest({ action: "update_photo", uid, photo: photoUrl });
      console.log("Update photo response:", text);
      try {
        const result = JSON.parse(text);
        if (result.success) return { success: true };
        return { success: false, error: (result && result.error) || 'unknown' };
      } catch (parseErr) {
        console.error("Failed to parse update_photo response:", text);
        return { success: false, error: 'parse_error' };
      }
    } catch (e) {
      console.error("Update photo failed:", e);
      return { success: false, error: 'network_error' };
    }
  }

  // Updates the editable profile fields (phone/city/area) on the Sheet. Unlike
  // sendRegistration(), this checks and returns the actual success flag — callers
  // must not mirror to Firebase unless this resolves { success: true }.
  async function updateProfile(uid, fields) {
    try {
      const text = await _sheetsRequest({
        action: "update_profile",
        uid,
        phone: fields.phone,
        city: fields.city,
        area: fields.area
      });
      console.log("Update profile response:", text);
      try {
        const result = JSON.parse(text);
        if (result.success) return { success: true };
        return { success: false, error: (result && result.error) || 'unknown' };
      } catch (parseErr) {
        console.error("Failed to parse update_profile response:", text);
        return { success: false, error: 'parse_error' };
      }
    } catch (e) {
      console.error("Update profile failed:", e);
      return { success: false, error: 'network_error' };
    }
  }

  // NOTE: there is no fetchSanghMembers() here — app.js's _fetchAdminUsers()
  // reads sangh_members/{code} directly (uids only, no denormalized name;
  // it reads each member's own users/{uid} record in the same pass, which
  // already has the current name — see that function's own comment for why
  // v4's denormalized-name approach here was dropped: it's the same
  // staleness risk the sangh-name fix earlier in this project's history
  // already had to correct once).

  return {
    init,
    signInWithGoogle,
    signOut,
    onAuthStateChanged,
    isAuthResolved,
    getCurrentUser,
    sendRegistration,
    fetchSanghs,
    fetchStats,
    updateProfile,
    fetchPhotoUrl,
    uploadPhoto,
    deletePhoto,
    updatePhoto,
    // Multi-profile identity
    baseUidOf,
    getActiveProfileId,
    setActiveProfile,
    getNextProfileId,
    fetchProfiles,
    MAX_PROFILES,
    retryRoleCheck
  };
})();
