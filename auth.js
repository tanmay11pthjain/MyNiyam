// ===== MyNiyam V4 — Firebase Google Auth + Sheets Role Lookup =====

const Auth = (() => {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbysnFVeHYnOj9yqZzXCtBV2KQfStNV8GMe-ABHPxM4a7GA16yWziTkqM3ouyHb2wEMp/exec";

  let currentUser = null;
  let authListeners = [];
  let _unsubFirebase = null;

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
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "google_login", uid, email, name }),
        redirect: "follow"
      });
      const text = await response.text();
      console.log("Sheets login response:", text);
      try {
        const result = JSON.parse(text);
        if (result.success) {
          return { role: result.role || "user", sanghCodes: result.sanghCodes || [], registered: !!result.registered };
        }
      } catch (parseErr) {
        console.error("Failed to parse Sheets response:", text);
      }
    } catch (e) {
      console.error("Sheets role fetch failed:", e);
    }
    return { role: "user", sanghCodes: [], registered: false };
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
        const { role, sanghCodes, registered } = await _fetchRoleFromSheets(
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
          registered: registered
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
    if (_sanghsCache) return _sanghsCache;
    if (_sanghsFetchPromise) return _sanghsFetchPromise;

    _sanghsFetchPromise = (async () => {
      try {
        const response = await fetch(APPS_SCRIPT_URL + "?action=get_sanghs", {
          method: "GET",
          redirect: "follow"
        });
        const text = await response.text();
        console.log("Sanghs response:", text);
        try {
          const result = JSON.parse(text);
          if (result.success) {
            _sanghsCache = result.sanghs || [];
            return _sanghsCache;
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

  async function sendRegistration(uid, email, regData) {
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "register",
          uid,
          email,
          name: regData.name,
          dob: regData.dob,
          phone: regData.phone,
          city: regData.city,
          area: regData.area,
          sanghCode: regData.sanghCode || ""
        }),
        redirect: "follow"
      });
      const text = await response.text();
      console.log("Sheets registration response:", text);
    } catch (e) {
      console.error("Registration sheet update failed:", e);
    }
  }

  // Fetch users belonging to specific sangh codes from the Sheet (master)
  async function fetchSanghUsers(sanghCodes) {
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "get_sangh_users", sanghCodes: sanghCodes }),
        redirect: "follow"
      });
      const text = await response.text();
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
    fetchSanghUsers
  };
})();
