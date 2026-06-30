// ===== KALYAN MITRA V2 — AUTHENTICATION MODULE =====
// SHA-256 hashed passwords with salt, session management, rate limiting

const Auth = (() => {
  // ===== CREDENTIALS (SHA-256 hashed with unique salts) =====
  // NEVER store plaintext passwords. These hashes were pre-computed.
  const CREDENTIALS = {
    admin: {
      role: 'admin',
      salt: '8f3a9c2b1d4e6f70',
      passwordHash: 'ead001aacf6d5e42fcabc9dbea8275e40951048d17bc99713bf82f2a6e7ccca5',
      persistent: false  // sessionStorage — dies on tab close
    },
    sadhak1: {
      role: 'user',
      salt: 'c7b2e5d8a1f3094c',
      passwordHash: '42102cd5e0ab653c8256ee906bfb96ea81b421c96b87aa24c3c88c5604e2e13b',
      persistent: true   // localStorage — persists forever
    }
  };

  // ===== RATE LIMITING =====
  const MAX_ATTEMPTS = 5;
  const COOLDOWN_MS = 30000; // 30 seconds
  let loginAttempts = 0;
  let cooldownUntil = 0;

  // ===== SESSION KEYS =====
  const SESSION_KEY_LOCAL = 'km_session_user';
  const SESSION_KEY_SESSION = 'km_session_admin';
  const SESSION_ROLE_LOCAL = 'km_role_user';
  const SESSION_ROLE_SESSION = 'km_role_admin';

  // ===== CRYPTO UTILITIES =====
  async function sha256(message) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function generateToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }

  // ===== SESSION MANAGEMENT =====
  function storeSession(username, role, persistent) {
    const token = generateToken();
    const sessionData = JSON.stringify({ username, role, token, createdAt: Date.now() });

    if (persistent) {
      localStorage.setItem(SESSION_KEY_LOCAL, sessionData);
    } else {
      sessionStorage.setItem(SESSION_KEY_SESSION, sessionData);
    }
    return token;
  }

  function getSession() {
    // Check localStorage first (persistent user session)
    const localSession = localStorage.getItem(SESSION_KEY_LOCAL);
    if (localSession) {
      try {
        const data = JSON.parse(localSession);
        if (data.token && data.role && data.username) {
          return data;
        }
      } catch (e) { /* corrupted, ignore */ }
    }

    // Check sessionStorage (admin session)
    const sessionData = sessionStorage.getItem(SESSION_KEY_SESSION);
    if (sessionData) {
      try {
        const data = JSON.parse(sessionData);
        if (data.token && data.role && data.username) {
          return data;
        }
      } catch (e) { /* corrupted, ignore */ }
    }

    return null;
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY_LOCAL);
    sessionStorage.removeItem(SESSION_KEY_SESSION);
  }

  // ===== LOGIN =====
  async function login(username, password) {
    // Rate limit check
    const now = Date.now();
    if (now < cooldownUntil) {
      const remaining = Math.ceil((cooldownUntil - now) / 1000);
      return { success: false, error: `Too many attempts. Try again in ${remaining}s.`, rateLimited: true };
    }

    // Sanitize inputs
    username = String(username).trim().toLowerCase();
    password = String(password);

    if (!username || !password) {
      return { success: false, error: 'Please enter username and password.' };
    }

    // Find user
    const user = CREDENTIALS[username];
    if (!user) {
      loginAttempts++;
      if (loginAttempts >= MAX_ATTEMPTS) {
        cooldownUntil = Date.now() + COOLDOWN_MS;
        loginAttempts = 0;
        return { success: false, error: 'Too many failed attempts. Please wait 30 seconds.', rateLimited: true };
      }
      return { success: false, error: 'Invalid username or password.' };
    }

    // Hash and compare
    const hash = await sha256(user.salt + password);
    if (hash !== user.passwordHash) {
      loginAttempts++;
      if (loginAttempts >= MAX_ATTEMPTS) {
        cooldownUntil = Date.now() + COOLDOWN_MS;
        loginAttempts = 0;
        return { success: false, error: 'Too many failed attempts. Please wait 30 seconds.', rateLimited: true };
      }
      return { success: false, error: 'Invalid username or password.' };
    }

    // Success — reset attempts and create session
    loginAttempts = 0;
    const token = storeSession(username, user.role, user.persistent);
    return { success: true, role: user.role, username, token };
  }

  function logout() {
    clearSession();
  }

  function validateSession() {
    return getSession();
  }

  function isRateLimited() {
    return Date.now() < cooldownUntil;
  }

  function getRateLimitRemaining() {
    if (Date.now() >= cooldownUntil) return 0;
    return Math.ceil((cooldownUntil - Date.now()) / 1000);
  }

  // Public API
  return {
    login,
    logout,
    validateSession,
    getSession,
    isRateLimited,
    getRateLimitRemaining
  };
})();
