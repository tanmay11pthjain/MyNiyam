// ===== MyNiyam V4 — Firebase Google Auth + Sheets Role Lookup =====

const Auth = (() => {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbysnFVeHYnOj9yqZzXCtBV2KQfStNV8GMe-ABHPxM4a7GA16yWziTkqM3ouyHb2wEMp/exec";

  let currentUser = null;
  let authListeners = [];
  let _unsubFirebase = null;

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

  async function _fetchRoleFromSheets(uid, email, name) {
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
    return { role: "user", sanghCodes: [], registered: false, profile: null };
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
        currentUser = parsed;
        _notifyListeners();
      }
    } catch (e) { /* ignore */ }

    // Firebase auth state listener
    _unsubFirebase = firebase.auth().onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        // User is signed in — fetch role and registration status from Sheets (master)
        const { role, sanghCodes, registered, profile } = await _fetchRoleFromSheets(
          firebaseUser.uid,
          firebaseUser.email,
          firebaseUser.displayName || firebaseUser.email.split('@')[0]
        );

        currentUser = {
          uid: firebaseUser.uid,
          role: role,
          name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
          email: firebaseUser.email,
          photoURL: firebaseUser.photoURL,
          sanghCodes: sanghCodes,
          registered: registered,
          profile: profile
        };

        localStorage.setItem('myniyam_session', JSON.stringify(currentUser));
        _notifyListeners();
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
    updatePhoto
  };
})();
