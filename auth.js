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

  // ===== FETCH ROLE FROM SHEETS =====
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
        if (result.success) return result.role || "user";
      } catch (parseErr) {
        console.error("Failed to parse Sheets response:", text);
      }
    } catch (e) {
      console.error("Sheets role fetch failed:", e);
    }
    return "user";
  }

  // ===== INIT — Start Firebase auth listener =====
  function init() {
    // Check for cached session first for instant UI
    try {
      const saved = localStorage.getItem('myniyam_session');
      if (saved) {
        currentUser = JSON.parse(saved);
        _notifyListeners();
      }
    } catch (e) { /* ignore */ }

    // Firebase auth state listener
    _unsubFirebase = firebase.auth().onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        // User is signed in — fetch role from Sheets
        const role = await _fetchRoleFromSheets(
          firebaseUser.uid,
          firebaseUser.email,
          firebaseUser.displayName || firebaseUser.email.split('@')[0]
        );

        currentUser = {
          uid: firebaseUser.uid,
          role: role,
          name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
          email: firebaseUser.email,
          photoURL: firebaseUser.photoURL
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
          area: regData.area
        }),
        redirect: "follow"
      });
      const text = await response.text();
      console.log("Sheets registration response:", text);
    } catch (e) {
      console.error("Registration sheet update failed:", e);
    }
  }

  return {
    init,
    signInWithGoogle,
    signOut,
    onAuthStateChanged,
    getCurrentUser,
    sendRegistration
  };
})();
