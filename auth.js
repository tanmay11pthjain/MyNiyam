// ===== MyNiyam V4 — Google Sheets Auth =====
// Uses a deployed Google Apps Script Web App for authentication

const Auth = (() => {
  // Replace this with the URL generated when deploying the Apps Script
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbysnFVeHYnOj9yqZzXCtBV2KQfStNV8GMe-ABHPxM4a7GA16yWziTkqM3ouyHb2wEMp/exec";

  let currentUser = null;
  let authListeners = [];

  // Load session from local storage on boot
  try {
    const saved = localStorage.getItem('myniyam_session');
    if (saved) {
      currentUser = JSON.parse(saved);
    }
  } catch (e) {
    console.error("Failed to load session:", e);
  }

  // ===== SIGN IN =====
  async function signIn(userid, password) {
    if (APPS_SCRIPT_URL === "YOUR_APPS_SCRIPT_WEB_APP_URL") {
      // Mock login if URL not set for testing
      console.warn("Using mock login since Apps Script URL is not set.");
      if (userid === "admin") {
        currentUser = { uid: "admin_123", role: "admin", name: "Admin" };
      } else {
        currentUser = { uid: userid, role: "user", name: userid };
      }
      localStorage.setItem('myniyam_session', JSON.stringify(currentUser));
      _notifyListeners();
      return { success: true, user: currentUser };
    }

    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({ userid, password })
      });

      const result = await response.json();

      if (result.success) {
        currentUser = {
          uid: result.uid,
          role: result.role,
          name: result.name
        };
        localStorage.setItem('myniyam_session', JSON.stringify(currentUser));
        _notifyListeners();
        return { success: true, user: currentUser };
      } else {
        return { success: false, error: result.error || "Login failed" };
      }
    } catch (error) {
      return { success: false, error: "Network error: " + error.message };
    }
  }

  // ===== SIGN OUT =====
  function signOut() {
    currentUser = null;
    localStorage.removeItem('myniyam_session');
    _notifyListeners();
  }

  // ===== AUTH STATE LISTENER =====
  function onAuthStateChanged(callback) {
    authListeners.push(callback);
    // Immediately call with current state
    callback(currentUser);

    // Return unsubscribe function
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

  return {
    signIn,
    signOut,
    onAuthStateChanged,
    getCurrentUser
  };
})();
