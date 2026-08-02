// ===== MyNiyam V4 — Firebase Google Auth + Sheets Role Lookup =====

const Auth = (() => {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbysnFVeHYnOj9yqZzXCtBV2KQfStNV8GMe-ABHPxM4a7GA16yWziTkqM3ouyHb2wEMp/exec";

  let currentUser = null;
  let authListeners = [];
  let _unsubFirebase = null;

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

  // Lists every profile under one Google account — Sheet is master (see
  // handleGetProfiles in apps-script-additions.gs). Returns null on ANY
  // failure (transport error, parse error, or the Sheet reporting
  // success:false) — callers must treat that as "unknown", never as "this
  // account has just one profile". A brand-new account with zero Sheet rows
  // is still a genuine, successful answer (not a failure), so THAT case
  // gets a primary placeholder rather than null.
  async function fetchProfiles(baseUid) {
    try {
      const text = await _sheetsRequest({ action: "get_profiles", baseUid });
      console.log("Profiles response:", text);
      try {
        const result = JSON.parse(text);
        if (result.success && Array.isArray(result.profiles)) {
          const profiles = result.profiles
            .map(p => ({
              profileId: String(p.profileId || '').trim(),
              name: String(p.name || '').trim(),
              sanghCode: String(p.sanghCode || '').trim(),
              registered: !!p.registered
            }))
            .filter(p => p.profileId);
          return profiles.length > 0
            ? profiles
            : [{ profileId: baseUid, name: '', sanghCode: '', registered: false }];
        }
      } catch (parseErr) {
        console.error("Failed to parse profiles response:", text);
      }
    } catch (e) {
      console.error("Fetch profiles failed:", e);
    }
    // A genuine failure. Returning null (not a fabricated single-profile
    // list) is what stops app.js's _loadAccountProfiles() from treating a
    // failed request as authoritative — feeding it a fallback that looks
    // identical to a real "just the primary" account is what silently
    // bounced a newly added, not-yet-registered profile back to the primary.
    return null;
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

  // Single attempt against the Sheet. Returns the parsed shape on a genuine
  // answer, or null on ANY failure (transport error, parse error, or the
  // Sheet itself reporting success:false) — callers must never treat null
  // as "not registered". Conflating "the request failed" with "this person
  // hasn't registered" was a real bug: it sent a fully-registered user (whose
  // Sheet row is perfectly intact) to the registration form, which would
  // have overwritten that row on submit.
  async function _tryFetchRoleFromSheets(uid, email, name) {
    try {
      const text = await _sheetsRequest({ action: "google_login", uid, email, name });
      console.log("Sheets login response:", text);
      try {
        const result = JSON.parse(text);
        if (result.success) {
          return {
            role: result.role || "user",
            sanghCodes: result.sanghCodes || [],
            registered: !!result.registered,
            // Piggybacks the Sheet's full row onto every login response — see
            // apps-script-additions.gs handleGoogleLogin — so the app can sync
            // Sheet edits (including a changed Sangh Code) on every load with
            // no extra network request. null for a not-yet-registered user.
            profile: result.profile || null
          };
        }
      } catch (parseErr) {
        console.error("Failed to parse Sheets response:", text);
      }
    } catch (e) {
      console.error("Sheets role fetch failed:", e);
    }
    return null;
  }

  // Retries a few times with a short delay so a single cold-start/network
  // blip self-heals instead of being mistaken for "not registered". If every
  // attempt fails, resolves registered: undefined — NEVER false. init()
  // already treats undefined as "don't decide yet, keep waiting" (it's what
  // a cached session uses while the fresh check is in flight), so this
  // leaves an inconclusive lookup on the loading screen with its retry
  // affordance, rather than routing a real user into a destructive
  // registration form. google_login is a pure read (plus an idempotent
  // UID-backfill write it already does at most once), so retrying it is safe.
  async function _fetchRoleFromSheets(uid, email, name) {
    const ATTEMPTS = 3;
    const RETRY_DELAY_MS = 1200;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const result = await _tryFetchRoleFromSheets(uid, email, name);
      if (result) return result;
      if (attempt < ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    console.error(`Sheets role fetch failed after ${ATTEMPTS} attempts — leaving registration status undetermined.`);
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

    // Fetch role and registration status from Sheets (master)
    const { role, sanghCodes, registered, profile } = await _fetchRoleFromSheets(
      activeProfileId,
      firebaseUser.email,
      firebaseUser.displayName || firebaseUser.email.split('@')[0]
    );

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

  // Manually re-runs the Sheet role/registration check for whichever
  // Firebase user is currently signed in. Bound to the loading screen's
  // Retry button, which only appears if _fetchRoleFromSheets's own internal
  // attempts all failed. No-op if nobody is signed in (shouldn't happen
  // while the loading screen is up, but defensive regardless).
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
          parsed.uid = getActiveProfileId(parsed.baseUid);
        }
        currentUser = parsed;
        _notifyListeners();
      }
    } catch (e) { /* ignore */ }

    // Firebase auth state listener
    _unsubFirebase = firebase.auth().onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        await _resolveAndPublishUser(firebaseUser);
      } else {
        // User signed out
        if (currentUser) {
          currentUser = null;
          localStorage.removeItem('myniyam_session');
          _notifyListeners();
        }
      }
    });
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

  async function fetchSanghs() {
    // Only a non-empty result is treated as cached — an empty list (e.g. from a
    // backend that isn't deployed yet) must not permanently stick for the session.
    if (_sanghsCache && _sanghsCache.length) return _sanghsCache;
    if (_sanghsFetchPromise) return _sanghsFetchPromise;

    _sanghsFetchPromise = (async () => {
      try {
        const text = await _sheetsRequest({ action: "get_sanghs" });
        console.log("Sanghs response:", text);
        try {
          const result = JSON.parse(text);
          if (result.success) {
            // Normalize every row to trimmed strings — Sheets can return a
            // numeric-looking code as a number, which would throw inside
            // s.code.toLowerCase() in the autocomplete filter — and drop any row
            // with no code.
            const sanghs = (result.sanghs || [])
              .map(s => ({
                code: String(s.code || '').trim(),
                name: String(s.name || '').trim(),
                city: String(s.city || '').trim()
              }))
              .filter(s => s.code);
            if (sanghs.length) _sanghsCache = sanghs;
            return sanghs;
          }
        } catch (parseErr) {
          console.error("Failed to parse Sanghs response:", text);
        }
      } catch (e) {
        console.error("Fetch sanghs failed:", e);
      }
      return [];
    })();

    try {
      return await _sanghsFetchPromise;
    } finally {
      _sanghsFetchPromise = null;
    }
  }

  let _statsCache = null;
  let _statsFetchPromise = null;

  // Public, aggregate-only counts for the landing page (get_stats returns
  // just { users, sanghs } — no uid, name, email, or sangh row). Mirrors
  // fetchSanghs()'s memoization pattern, and — unlike fetchSanghs — resolves
  // null (not an empty object) on ANY failure, so the landing page can tell
  // "no data yet" apart from "genuinely zero" and render a dash instead of 0.
  async function fetchStats() {
    if (_statsCache) return _statsCache;
    if (_statsFetchPromise) return _statsFetchPromise;

    _statsFetchPromise = (async () => {
      try {
        const text = await _sheetsRequest({ action: "get_stats" });
        console.log("Stats response:", text);
        try {
          const result = JSON.parse(text);
          if (result.success) {
            const stats = {
              users: Number(result.users) || 0,
              sanghs: Number(result.sanghs) || 0
            };
            _statsCache = stats;
            return stats;
          }
        } catch (parseErr) {
          console.error("Failed to parse Stats response:", text);
        }
      } catch (e) {
        console.error("Fetch stats failed:", e);
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

  // Fetch a single user's profile photo (data URL) from the Sheet. Its own
  // action — deliberately separate from fetchProfile()/get_profile — so the
  // image never rides along with lighter, more frequent requests.
  async function fetchPhoto(uid) {
    try {
      const text = await _sheetsRequest({ action: "get_photo", uid }, { allowJsonp: false });
      console.log("Get photo response length:", text ? text.length : 0);
      try {
        const result = JSON.parse(text);
        if (result.success) return result.photo || null;
      } catch (parseErr) {
        console.error("Failed to parse get_photo response:", text);
      }
    } catch (e) {
      console.error("Fetch photo failed:", e);
    }
    return null;
  }

  // Uploads a resized/compressed data URL as the user's profile photo.
  // Response-checked like updateProfile() — callers must not treat this as
  // successful unless it resolves { success: true }.
  async function updatePhoto(uid, dataUrl) {
    try {
      const text = await _sheetsRequest({ action: "update_photo", uid, photo: dataUrl }, { allowJsonp: false });
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

  // Fetch a single user's full profile row from the Sheet (master). Deliberately
  // uncached — the Profile tab calls this on every open so Sheet-side edits show up.
  // Returns the profile object on success, or null (caller falls back to Firebase).
  async function fetchProfile(uid) {
    try {
      const text = await _sheetsRequest({ action: "get_profile", uid });
      console.log("Get profile response:", text);
      try {
        const result = JSON.parse(text);
        if (result.success) return result.profile || null;
      } catch (parseErr) {
        console.error("Failed to parse get_profile response:", text);
      }
    } catch (e) {
      console.error("Fetch profile failed:", e);
    }
    return null;
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

  // Fetch users belonging to specific sangh codes from the Sheet (master)
  async function fetchSanghUsers(sanghCodes) {
    try {
      const text = await _sheetsRequest({ action: "get_sangh_users", sanghCodes: sanghCodes });
      console.log("Sangh users response:", text);
      try {
        const result = JSON.parse(text);
        if (result.success) return result.users || [];
      } catch (parseErr) {
        console.error("Failed to parse sangh users response:", text);
      }
    } catch (e) {
      console.error("Fetch sangh users failed:", e);
    }
    return [];
  }

  return {
    init,
    signInWithGoogle,
    signOut,
    onAuthStateChanged,
    getCurrentUser,
    sendRegistration,
    fetchSanghs,
    fetchStats,
    fetchSanghUsers,
    fetchProfile,
    updateProfile,
    fetchPhoto,
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
