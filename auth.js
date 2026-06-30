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
  function sha256_js(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let i;
    let result = '';
    const hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const words = [];
    const asciiLength = ascii.length;
    const wordsLength = ((asciiLength + 8) >> 6) + 1;
    for (i = 0; i < wordsLength * 16; i++) words[i] = 0;
    for (i = 0; i < asciiLength; i++) {
      words[i >> 2] |= ascii.charCodeAt(i) << (24 - (i % 4) * 8);
    }
    words[asciiLength >> 2] |= 0x80 << (24 - (asciiLength % 4) * 8);
    words[wordsLength * 16 - 1] = asciiLength * 8;

    for (let chunkStart = 0; chunkStart < words.length; chunkStart += 16) {
      let a = hash[0], b = hash[1], c = hash[2], d = hash[3], e = hash[4], f = hash[5], g = hash[6], h = hash[7];
      const w = [];
      for (i = 0; i < 64; i++) {
        if (i < 16) {
          w[i] = words[chunkStart + i];
        } else {
          const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
          const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const ch = (e & f) ^ ((~e) & g);
        const temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
        const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) | 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) | 0;
      }
      hash[0] = (hash[0] + a) | 0;
      hash[1] = (hash[1] + b) | 0;
      hash[2] = (hash[2] + c) | 0;
      hash[3] = (hash[3] + d) | 0;
      hash[4] = (hash[4] + e) | 0;
      hash[5] = (hash[5] + f) | 0;
      hash[6] = (hash[6] + g) | 0;
      hash[7] = (hash[7] + h) | 0;
    }

    for (i = 0; i < 8; i++) {
      let val = hash[i];
      if (val < 0) val += maxWord;
      let hex = val.toString(16);
      while (hex.length < 8) hex = '0' + hex;
      result += hex;
    }
    return result;
  }

  async function sha256(message) {
    if (window.crypto && window.crypto.subtle) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {
        return sha256_js(message);
      }
    }
    return sha256_js(message);
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
