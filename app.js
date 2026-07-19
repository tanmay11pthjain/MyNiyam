// ===== KALYAN MITRA V2 — CORE APPLICATION =====
// Auth-gated, admin-controlled, reversible submissions

let app; // Global reference


// ===== FIREBASE INITIALIZATION =====
const firebaseConfig = {
  apiKey: "AIzaSyD0zrP8fdjBvqu3lbdv2I6E3Z60Fb0MwlE",
  authDomain: "my-niyam.firebaseapp.com",
  projectId: "my-niyam",
  storageBucket: "my-niyam.firebasestorage.app",
  messagingSenderId: "738555186123",
  appId: "1:738555186123:web:60c8259dc3844a5f29444e",
  measurementId: "G-ZJP9LR4RLT",
  databaseURL: "https://my-niyam-default-rtdb.firebaseio.com"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

class KalyanMitra {
  constructor() {
    this.currentRole = null;
    this.pendingBadges = [];
    this.autoLockInterval = null;
    this.currentDayLocked = false;
    this.init();
  }

  // ===== INITIALIZATION =====
  async init() {
    Auth.onAuthStateChanged(user => {
      if (user) {
        this.uid = user.uid;
        this.currentRole = user.role;
        // Save user identity to Firebase so admin can see names
        db.ref(`users/${user.uid}/name`).set(user.name || user.uid);
        db.ref(`users/${user.uid}/role`).set(user.role);
        document.getElementById('login-screen').classList.add('hidden');
        if (user.role === 'admin') {
          this.initAdmin();
        } else {
          this.initUser();
        }
      } else {
        this.showLoginScreen();
      }
    });
  }

  showLoginScreen() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('app-hidden');
    document.getElementById('app').classList.remove('app-visible');
    document.getElementById('admin-panel').classList.add('hidden');

    // Create particles
    this.createLoginParticles();

    // Setup login form
    const form = document.getElementById('login-form');
    form.onsubmit = (e) => {
      e.preventDefault();
      this.handleLogin();
    };
  }

  createLoginParticles() {
    const container = document.getElementById('login-particles');
    if (container.children.length > 0) return; // Already created
    for (let i = 0; i < 15; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = `${Math.random() * 100}%`;
      particle.style.top = `${60 + Math.random() * 40}%`;
      particle.style.animationDelay = `${Math.random() * 2}s`;
      particle.style.animationDuration = `${2 + Math.random() * 3}s`;
      particle.style.width = particle.style.height = `${3 + Math.random() * 5}px`;
      container.appendChild(particle);
    }
  }

  async handleLogin() {
    const username = document.getElementById('login-username').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value.trim();
    const errorEl = document.getElementById('login-error');
    const btnEl = document.getElementById('btn-login');
    const loadingEl = document.getElementById('btn-login-loading');

    // Disable button during login
    btnEl.disabled = true;
    loadingEl.classList.remove('hidden');
    errorEl.classList.add('hidden');

    const result = await Auth.signIn(username, password);

    btnEl.disabled = false;
    loadingEl.classList.add('hidden');

    if (!result.success) {
      errorEl.textContent = result.error;
      errorEl.classList.remove('hidden');
      errorEl.classList.add('show');

      // Shake animation on error
      const card = document.querySelector('.login-card');
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 500);
    }
  }



  // ===== USER INITIALIZATION =====
  async initUser() {
    this.initializing = true;
    await this.setupRealtimeSync();
    this.initializing = false;

    document.getElementById('app').classList.remove('app-hidden');
    document.getElementById('app').classList.add('app-visible');
    document.getElementById('admin-panel').classList.add('hidden');

    this.checkDailyReset();
    await this.fetchGeolocationAndPanchang();
    this.grantDailyLogin();
    this.renderDashboard();
    this.renderAchievements();
    this.setupUserEventListeners();
    this.startAutoLockCheck();
    this.checkStreakWarning();
  }

  async fetchGeolocationAndPanchang() {
    if (navigator.geolocation) {
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        
        this.settings.locationLat = position.coords.latitude;
        this.settings.locationLng = position.coords.longitude;
        this.settings.locationName = "Live Location";
        this.saveSettings();
      } catch (e) {
        console.warn("Geolocation denied or timeout. Using fallback location.", e);
      }
    }
    await this.calculatePanchang();
  }

  // ===== ADMIN INITIALIZATION =====
  async initAdmin() {
    this.initializing = false;
    this.settings = { ...DEFAULT_SETTINGS };

    document.getElementById('admin-panel').classList.remove('hidden');
    document.getElementById('app').classList.add('app-hidden');
    document.getElementById('app').classList.remove('app-visible');

    // Setup Admin Event Listeners (Tabs, Logout, etc.)
    this.setupAdminEventListeners();

    // Start global settings listener so Settings tab works immediately
    this._settingsRef = db.ref('settings');
    this._settingsListener = this._settingsRef.on('value', snap => {
      this.settings = snap.val() ? { ...DEFAULT_SETTINGS, ...snap.val() } : { ...DEFAULT_SETTINGS };
      this.loadAdminSettingsUI();
    });

    // Fetch and render Leaderboard
    await this.renderAdminLeaderboard();
  }

  startLeaderboardListener() {
    // Detach previous leaderboard listener if any
    if (this._leaderboardRef) {
      this._leaderboardRef.off('value', this._leaderboardListener);
    }

    this._leaderboardRef = db.ref('users');
    this._leaderboardListener = this._leaderboardRef.on('value', snap => {
      this._renderLeaderboardFromSnap(snap);
      this._renderOverviewFromSnap(snap);
    });
  }

  _renderOverviewFromSnap(snap) {
    const grid = document.getElementById('admin-overview-grid');
    if (!grid) return;

    const allUsers = snap.val() || {};
    const todayKey = this.getTodayKey();
    let totalUsers = 0, activeToday = 0, totalKP = 0;

    // Activity counters
    const acts = {
      navkarsi: { icon: '🌅', name: 'Navkarsi', count: 0 },
      wakeup: { icon: '⏰', name: 'Wake < 7AM', count: 0 },
      sleep: { icon: '🌙', name: 'Sleep < 12AM', count: 0 },
      pranam: { icon: '🙇', name: 'Pranam', count: 0 },
      pooja: { icon: '🪔', name: 'Pooja', count: 0 },
      samayik: { icon: '🧘', name: 'Samayik', count: 0 },
      pratikraman: { icon: '🙏', name: 'Pratikraman', count: 0 },
      book: { icon: '📖', name: 'Book Reading', count: 0 },
      ratribhojan: { icon: '🍽️', name: 'Ratri Bhojan Tyag', count: 0 },
      kandmool: { icon: '🌱', name: 'Kandmool Tyag', count: 0 },
      niyam: { icon: '✨', name: 'Daily Niyam', count: 0 },
    };

    Object.entries(allUsers).forEach(([uid, data]) => {
      if (data.role === 'admin') return; // skip admin accounts
      totalUsers++;
      totalKP += data.profile?.totalKP || 0;

      const dayLog = data.daily_logs?.[todayKey];
      if (dayLog) {
        activeToday++;
        if (dayLog.navkarsiDone) acts.navkarsi.count++;
        if (dayLog.wakeUpDone) acts.wakeup.count++;
        if (dayLog.sleepDone) acts.sleep.count++;
        if (dayLog.pranamDone) acts.pranam.count++;
        if (dayLog.poojaDone) acts.pooja.count++;
        if ((dayLog.samayikDone || 0) > 0) acts.samayik.count++;
        if ((dayLog.pratikramanDone || 0) > 0) acts.pratikraman.count++;
        if ((dayLog.bookReadingMins || 0) >= 30) acts.book.count++;
        if (dayLog.ratriBhojanDone) acts.ratribhojan.count++;
        if (dayLog.kandmoolDone) acts.kandmool.count++;
        if (dayLog.dailyNiyamDone) acts.niyam.count++;
      }
    });

    document.getElementById('ov-total-users').textContent = totalUsers;
    document.getElementById('ov-active-today').textContent = activeToday;
    document.getElementById('ov-total-kp').textContent = totalKP;

    grid.innerHTML = Object.values(acts).map(a => `
      <div class="admin-activity-item">
        <span class="admin-act-icon">${a.icon}</span>
        <span class="admin-act-name">${a.name}</span>
        <span class="admin-act-status ${a.count > 0 ? 'done' : ''}">${a.count}/${totalUsers}</span>
      </div>
    `).join('');
  }

  _renderLeaderboardFromSnap(snap) {
    const listEl = document.getElementById('admin-leaderboard-list');
    if (!listEl) return;

    const allUsers = snap.val() || {};
    const users = [];
    Object.entries(allUsers).forEach(([uid, data]) => {
      if (data.role === 'admin') return;
      if (!data.role || data.role === 'user' || data.profile) {
        users.push({
          uid,
          name: data.name || uid,
          kp: data.profile?.totalKP || 0,
          streak: data.profile?.currentStreak || 0
        });
      }
    });

    users.sort((a, b) => b.kp - a.kp);

    if (users.length === 0) {
      listEl.innerHTML = '<div class="admin-desc">No users found. Login with a user account first.</div>';
      return;
    }

    listEl.innerHTML = users.map((u, index) => `
      <div class="leaderboard-card" data-uid="${u.uid}">
        <div class="lb-rank">#${index + 1}</div>
        <div class="lb-info">
          <span class="lb-name">${u.name}</span>
          <span class="lb-stats">${u.kp} KP • 🔥 ${u.streak}</span>
        </div>
        <div class="lb-action">👁️ View</div>
      </div>
    `).join('');

    listEl.querySelectorAll('.leaderboard-card').forEach(card => {
      card.addEventListener('click', () => {
        this.selectAdminUser(card.dataset.uid);
      });
    });
  }

  async renderAdminLeaderboard() {
    const listEl = document.getElementById('admin-leaderboard-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="text-align:center; padding: 20px; color: #795548;">Loading users...</div>';
    if (!this._leaderboardRef) {
      // First time — start real-time listener (fires immediately)
      this.startLeaderboardListener();
    } else {
      // Listener already running — do a one-time read to refresh now
      const snap = await db.ref('users').once('value');
      this._renderLeaderboardFromSnap(snap);
    }
  }

  async selectAdminUser(uid) {
    // Detach old user listeners (but keep leaderboard listener alive)
    this._detachAllListeners();
    
    // Set new target
    this.uid = uid;
    this.initializing = true;
    
    // Initialize defaults so renderAdminProgress doesn't read undefined
    this.profile = { ...DEFAULT_PROFILE };
    this.dailyLog = { ...DEFAULT_DAILY_LOG, date: this.getTodayKey() };
    this.settings = { ...DEFAULT_SETTINGS };
    this.currentDayLocked = false;
    
    // Show the individual view, hide the overview
    document.getElementById('admin-overview').classList.add('hidden');
    document.getElementById('admin-individual').classList.remove('hidden');
    
    const nameEl = document.getElementById('admin-viewing-name');
    
    // Fetch user name from top-level user record
    const nameSnap = await db.ref(`users/${uid}/name`).once('value');
    const userName = nameSnap.val() || uid;
    if (nameEl) nameEl.textContent = `Viewing: ${userName}`;
    
    // Reset admin history state to current month for new user
    const now = new Date();
    this._adminHistoryMonth = now.getMonth();
    this._adminHistoryYear = now.getFullYear();
    
    // Switch to Progress tab automatically
    this.switchAdminTab('admin-progress');
    
    // Start real-time syncing for this user's data
    await this.setupRealtimeSync();
    
    this.initializing = false;
    this.loadAdminSettingsUI();
    this.renderAdminProgress();
    this.renderAdminLock();
    this.renderAdminHistory();
  }

  // ===== EVENT LISTENERS =====
  setupUserEventListeners() {
    const bindSimple = (id, prop, points, elId = id) => {
      const btn = document.getElementById(`btn-${elId}`);
      const btnUndo = document.getElementById(`btn-${elId}-undo`);
      if (btn) btn.addEventListener('click', () => this.toggleSimpleActivity(elId, prop, true, points));
      if (btnUndo) btnUndo.addEventListener('click', () => this.toggleSimpleActivity(elId, prop, false, points));
    };

    bindSimple('navkarsi', 'navkarsiDone', POINTS.navkarsi);
    bindSimple('wakeup', 'wakeUpDone', POINTS.wakeUpEarly);
    bindSimple('sleep', 'sleepDone', POINTS.sleepEarly);
    bindSimple('pranam', 'pranamDone', POINTS.pranam);
    bindSimple('ratribhojan', 'ratriBhojanDone', POINTS.ratriBhojan);
    bindSimple('kandmool', 'kandmoolDone', POINTS.kandmool);
    bindSimple('niyam', 'dailyNiyamDone', POINTS.dailyNiyam);

    const btnPooja = document.getElementById('btn-pooja');
    const btnPoojaUndo = document.getElementById('btn-pooja-undo');
    if (btnPooja) btnPooja.addEventListener('click', () => this.completePooja());
    if (btnPoojaUndo) btnPoojaUndo.addEventListener('click', () => this.undoPooja());

    const ashtaCheck = document.getElementById('ashta-checkbox');
    if (ashtaCheck) ashtaCheck.addEventListener('change', () => this.toggleAshtaPrakari());

    const bindCounter = (id, handler) => {
      const btnMinus = document.getElementById(`btn-${id}-minus`);
      const btnPlus = document.getElementById(`btn-${id}-plus`);
      if (btnMinus) btnMinus.addEventListener('click', () => handler(-1));
      if (btnPlus) btnPlus.addEventListener('click', () => handler(1));
    };

    bindCounter('samayik', (delta) => this.adjustCounter('samayikDone', delta, POINTS.samayik, 'samayik'));
    bindCounter('pratikraman', (delta) => this.adjustCounter('pratikramanDone', delta, POINTS.pratikraman, 'pratikraman'));
    bindCounter('book', (delta) => this.adjustCounter('bookReadingMins', delta * 30, POINTS.bookReading, 'book'));

    const bindScreenTime = (id, prop, delta) => {
      const btnMinus = document.getElementById(`btn-${id}-minus`);
      const btnPlus = document.getElementById(`btn-${id}-plus`);
      if (btnMinus) btnMinus.addEventListener('click', () => this.adjustScreenTime(prop, -delta));
      if (btnPlus) btnPlus.addEventListener('click', () => this.adjustScreenTime(prop, delta));
    };
    bindScreenTime('screen-h', 'screenTimeHours', 1);
    bindScreenTime('screen-m', 'screenTimeMins', 15);

    // Navigation
    document.querySelectorAll('#bottom-nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // History month navigation
    const hPrev = document.getElementById('btn-history-prev');
    const hNext = document.getElementById('btn-history-next');
    if (hPrev) hPrev.addEventListener('click', () => this._changeHistoryMonth(-1, false));
    if (hNext) hNext.addEventListener('click', () => this._changeHistoryMonth(1, false));

    // Logout
    document.getElementById('btn-user-logout').addEventListener('click', () => this.logout());

    // Overlays
    document.getElementById('btn-close-levelup').addEventListener('click', () => this.closeLevelUp());
    document.getElementById('btn-close-badge').addEventListener('click', () => this.closeBadgeUnlock());
    document.getElementById('btn-close-summary').addEventListener('click', () => this.closeEveningSummary());
  }

  setupAdminEventListeners() {
    // Admin nav
    document.querySelectorAll('#admin-bottom-nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.switchAdminTab(btn.dataset.tab));
    });

    // Save settings
    document.getElementById('btn-save-settings').addEventListener('click', () => this.saveAdminSettings());

    // Lock day
    document.getElementById('btn-lock-day').addEventListener('click', () => this.adminLockDay());

    // Reset
    document.getElementById('btn-admin-reset').addEventListener('click', () => this.resetProgress());

    // Logout
    document.getElementById('btn-admin-logout').addEventListener('click', () => this.logout());

    // Back to leaderboard
    const backBtn = document.getElementById('btn-back-leaderboard');
    if (backBtn) backBtn.addEventListener('click', () => {
      document.getElementById('admin-individual').classList.add('hidden');
      document.getElementById('admin-overview').classList.remove('hidden');
      this._detachAllListeners();
      this.switchAdminTab('admin-leaderboard');
    });

    // Admin history month navigation
    const ahPrev = document.getElementById('btn-admin-history-prev');
    const ahNext = document.getElementById('btn-admin-history-next');
    if (ahPrev) ahPrev.addEventListener('click', () => this._changeHistoryMonth(-1, true));
    if (ahNext) ahNext.addEventListener('click', () => this._changeHistoryMonth(1, true));
  }

  // ===== FIREBASE SYNC & REALTIME LISTENERS =====
  listenToRef(path, callback) {
    if (!this._activeListeners) this._activeListeners = [];
    return new Promise(resolve => {
      let first = true;
      const ref = db.ref(path);
      const listener = ref.on('value', snap => {
        callback(snap.val());
        if (first) {
          first = false;
          resolve();
        }
      });
      this._activeListeners.push({ ref, listener });
    });
  }

  _detachAllListeners() {
    if (this._activeListeners) {
      this._activeListeners.forEach(({ ref, listener }) => {
        ref.off('value', listener);
      });
      this._activeListeners = [];
    }
  }

  async setupRealtimeSync() {
    const todayKey = this.getTodayKey();
    const userPath = `users/${this.uid}`;

    const p1 = this.listenToRef('settings', val => {
      this.settings = val ? { ...DEFAULT_SETTINGS, ...val } : { ...DEFAULT_SETTINGS };
      if (!this.initializing) {
        if (this.currentRole === 'user') {
          this.calculatePanchang();
          this.renderDashboard();
        } else {
          this.loadAdminSettingsUI();
        }
      }
    });

    const p2 = this.listenToRef(`${userPath}/profile`, val => {
      this.profile = val ? { ...DEFAULT_PROFILE, ...val } : { ...DEFAULT_PROFILE };
      if (!this.initializing) {
        if (this.currentRole === 'admin') this.renderAdminProgress();
        else if (this.currentRole === 'user') this.renderAchievements();
      }
    });

    const p3 = this.listenToRef(`${userPath}/daily_logs/${todayKey}`, val => {
      if (val) this.dailyLog = { ...DEFAULT_DAILY_LOG, ...val };
      else this.dailyLog = { ...DEFAULT_DAILY_LOG, date: todayKey };
      if (!this.initializing) {
        if (this.currentRole === 'admin') {
          this.renderAdminProgress();
          this.renderAdminLock();
        } else {
          this.renderDashboard();
        }
      }
    });

    const p4 = this.listenToRef(`${userPath}/lock_status/${todayKey}`, val => {
      this.currentDayLocked = !!val;
      if (!this.initializing) {
        if (this.currentRole === 'user') this.updateLockUI();
        else if (this.currentRole === 'admin') this.renderAdminLock();
      }
    });

    await Promise.all([p1, p2, p3, p4]);
  }

  saveSettings() { db.ref('settings').set(this.settings); }
  saveProfile() { db.ref(`users/${this.uid}/profile`).set(this.profile); }
  saveDailyLog() {
    db.ref(`users/${this.uid}/daily_logs/${this.getTodayKey()}`).set(this.dailyLog);
  }
  saveAll() { this.saveSettings(); this.saveProfile(); this.saveDailyLog(); }

  getTodayKey(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ===== LOCK SYSTEM =====
  isDayLocked() {
    return this.currentDayLocked;
  }

  async lockDay() {
    const lockKey = `users/${this.uid}/lock_status/${this.getTodayKey()}`;
    await db.ref(lockKey).set(true);
    // Process end-of-day when locked
    this.processEndOfDay();
  }

  startAutoLockCheck() {
    // Check every 30 seconds if we crossed midnight
    this.autoLockInterval = setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        // Midnight — lock previous day
        const yKey = this.getTodayKey(-1);
        const yLockKey = `users/${this.uid}/lock_status/${yKey}`;
        const snap = await db.ref(yLockKey).once('value');
        if (!snap.val()) {
          db.ref(yLockKey).set(true);
        }
        // Reset for new day
        this.checkDailyReset();
        this.renderDashboard();
      }
      // Update lock UI
      this.updateLockUI();
    }, 30000);
  }

  updateLockUI() {
    const locked = this.isDayLocked();
    const banner = document.getElementById('lock-banner');
    const lockIds = [
      'navkarsi', 'wakeup', 'sleep', 'pranam',
      'pooja', 'samayik', 'pratikraman', 'book',
      'ratribhojan', 'kandmool', 'screentime', 'niyam'
    ];

    if (locked) {
      banner.classList.remove('hidden');
      lockIds.forEach(id => {
        const card = document.getElementById(`${id}-card`);
        const lockEl = document.getElementById(`${id}-lock`);
        if (card) card.classList.add('locked');
        if (lockEl) lockEl.classList.remove('hidden');
      });
      // Disable ALL interactive buttons (V3 classes)
      document.querySelectorAll('.btn-complete, .btn-complete-small, .btn-undo, .btn-undo-small, .btn-counter-small, .btn-niyam, .ashta-toggle input').forEach(el => {
        el.disabled = true;
      });
    } else {
      banner.classList.add('hidden');
      lockIds.forEach(id => {
        const card = document.getElementById(`${id}-card`);
        const lockEl = document.getElementById(`${id}-lock`);
        if (card) card.classList.remove('locked');
        if (lockEl) lockEl.classList.add('hidden');
      });
      // Re-enable — renderActivities will handle per-button disabled states
    }
  }

  // ===== DAILY RESET =====
  async checkDailyReset() {
    const todayKey = this.getTodayKey();
    if (this.dailyLog.date && this.dailyLog.date !== todayKey) {
      // Lock yesterday if not already locked
      const yLockKey = `users/${this.uid}/lock_status/${this.dailyLog.date}`;
      const snap = await db.ref(yLockKey).once('value');
      if (!snap.val()) {
        db.ref(yLockKey).set(true);
        this.processEndOfDay();
      }
      // New day
      this.dailyLog = { ...DEFAULT_DAILY_LOG, date: todayKey };
      this.saveDailyLog();
    }
  }

  processEndOfDay() {
    const allDone = this.isAllTasksComplete();
    this.updateStreak(allDone);
    if (allDone && !this.dailyLog.perfectDay) {
      this.dailyLog.perfectDay = true;
      this.profile.totalPerfectDays = (this.profile.totalPerfectDays || 0) + 1;
    }
    this.saveProfile();
    this.saveDailyLog();
  }

  grantDailyLogin() {
    const todayKey = this.getTodayKey();
    const lastLogin = localStorage.getItem(`km_lastLogin_${this.uid}`);
    if (lastLogin !== todayKey) {
      localStorage.setItem(`km_lastLogin_${this.uid}`, todayKey);
      this.addKarmaPoints(POINTS.dailyLogin, 'Daily Login Bonus!');
      this.profile.daysActive = (this.profile.daysActive || 0) + 1;
    }
  }

  // ===== PANCHANG CALCULATIONS =====
  async calculatePanchang() {
    const now = new Date();
    const lat = this.settings.locationLat;
    const lng = this.settings.locationLng;
    
    const tithiInfo = this.calculateTithi(now);
    
    let sunTimes;
    try {
      const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&formatted=0`;
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.status === "OK") {
        const sunriseUTC = new Date(data.results.sunrise);
        const sunsetUTC = new Date(data.results.sunset);
        
        const getDecimalHour = (d) => d.getHours() + (d.getMinutes() / 60);
        
        const sunriseLocal = getDecimalHour(sunriseUTC);
        const sunsetLocal = getDecimalHour(sunsetUTC);
        
        sunTimes = { 
          sunrise: sunriseLocal, 
          sunset: sunsetLocal, 
          navkarsi: sunriseLocal + (48 / 60) 
        };
      } else {
        throw new Error("API response not OK");
      }
    } catch (e) {
      console.warn("Failed to fetch Sunrise API, falling back to manual calc", e);
      sunTimes = this.calculateSunriseSunset(lat, lng, now);
    }

    this.renderPanchang(sunTimes, tithiInfo, now);
  }

  calculateSunriseSunset(lat, lng, date) {
    const toRad = (deg) => deg * (Math.PI / 180);
    const toDeg = (rad) => rad * (180 / Math.PI);
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    const zenith = 90.833;
    const lngHour = lng / 15;

    // Sunrise
    const tRise = dayOfYear + ((6 - lngHour) / 24);
    const mRise = (0.9856 * tRise) - 3.289;
    let lRise = mRise + (1.916 * Math.sin(toRad(mRise))) + (0.020 * Math.sin(toRad(2 * mRise))) + 282.634;
    lRise = ((lRise % 360) + 360) % 360;
    let raRise = toDeg(Math.atan(0.91764 * Math.tan(toRad(lRise))));
    raRise = ((raRise % 360) + 360) % 360;
    raRise += (Math.floor(lRise / 90) * 90) - (Math.floor(raRise / 90) * 90);
    raRise /= 15;
    const sinDecRise = 0.39782 * Math.sin(toRad(lRise));
    const cosDecRise = Math.cos(Math.asin(sinDecRise));
    const cosHRise = (Math.cos(toRad(zenith)) - (sinDecRise * Math.sin(toRad(lat)))) / (cosDecRise * Math.cos(toRad(lat)));
    const hRise = (360 - toDeg(Math.acos(Math.max(-1, Math.min(1, cosHRise))))) / 15;
    let utRise = hRise + raRise - (0.06571 * tRise) - 6.622;
    utRise = ((utRise % 24) + 24) % 24;

    // Sunset
    const tSet = dayOfYear + ((18 - lngHour) / 24);
    const mSet = (0.9856 * tSet) - 3.289;
    let lSet = mSet + (1.916 * Math.sin(toRad(mSet))) + (0.020 * Math.sin(toRad(2 * mSet))) + 282.634;
    lSet = ((lSet % 360) + 360) % 360;
    let raSet = toDeg(Math.atan(0.91764 * Math.tan(toRad(lSet))));
    raSet = ((raSet % 360) + 360) % 360;
    raSet += (Math.floor(lSet / 90) * 90) - (Math.floor(raSet / 90) * 90);
    raSet /= 15;
    const sinDecSet = 0.39782 * Math.sin(toRad(lSet));
    const cosDecSet = Math.cos(Math.asin(sinDecSet));
    const cosHSet = (Math.cos(toRad(zenith)) - (sinDecSet * Math.sin(toRad(lat)))) / (cosDecSet * Math.cos(toRad(lat)));
    const hSet = toDeg(Math.acos(Math.max(-1, Math.min(1, cosHSet)))) / 15;
    let utSet = hSet + raSet - (0.06571 * tSet) - 6.622;
    utSet = ((utSet % 24) + 24) % 24;

    const istOffset = 5.5;
    let sunriseIST = ((utRise + istOffset) % 24 + 24) % 24;
    let sunsetIST = ((utSet + istOffset) % 24 + 24) % 24;

    return { sunrise: sunriseIST, sunset: sunsetIST, navkarsi: sunriseIST + (48 / 60) };
  }

  formatTime(decimalHours) {
    const hours = Math.floor(decimalHours);
    const minutes = Math.round((decimalHours - hours) * 60);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
  }

  calculateTithi(date) {
    // Aligned to start of Kartik in 2025 to fix Adhik Maas drift
    const refNewMoon = new Date(Date.UTC(2025, 9, 22, 23, 0, 0));
    const synodicMonth = 29.53059;
    const daysSinceRef = (date.getTime() - refNewMoon.getTime()) / (1000 * 60 * 60 * 24);
    const moonAge = ((daysSinceRef % synodicMonth) + synodicMonth) % synodicMonth;
    const tithiDuration = synodicMonth / 30;
    const tithiIndex = Math.floor(moonAge / tithiDuration);
    let paksha, tithiName;
    if (tithiIndex < 15) {
      paksha = 'Shukla Paksha';
      tithiName = TITHI_NAMES[tithiIndex];
    } else {
      paksha = 'Krishna Paksha';
      tithiName = TITHI_NAMES_KRISHNA[tithiIndex - 15];
    }
    const lunarMonth = Math.floor(((daysSinceRef / synodicMonth) % 12 + 12) % 12);
    return { paksha, tithiName, jainMonth: JAIN_MONTHS[lunarMonth], tithiIndex };
  }

  // ===== RENDERING =====
  renderPanchang(sunTimes, tithiInfo, now) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('panchang-date').textContent = now.toLocaleDateString('en-IN', options);
    
    const pakshaName = tithiInfo.paksha === 'Shukla Paksha' ? 'Shukla' : 'Krushna';
    const tithiNum = (tithiInfo.tithiIndex % 15) + 1;
    document.getElementById('tithi-value').textContent = `${tithiInfo.jainMonth} ${pakshaName} ${tithiNum}`;
    
    if (sunTimes) {
      document.getElementById('sunrise-time').textContent = this.formatTime(sunTimes.sunrise);
      document.getElementById('navkarsi-time').textContent = this.formatTime(sunTimes.navkarsi);
      document.getElementById('sunset-time').textContent = this.formatTime(sunTimes.sunset);
    }
  }

  renderDashboard() {
    this.renderActivities();
    this.renderDailyProgress();
    this.renderNiyam();
    this.renderMotivation();
    this.renderHeader();
    this.updateLockUI();
  }

  renderHeader() {
    const level = this.getCurrentLevel();
    document.getElementById('level-icon').textContent = level.icon;
    document.getElementById('level-title').textContent = level.title;
    document.getElementById('karma-points').textContent = `${this.profile.totalKP} KP`;

    document.getElementById('streak-count').textContent = this.profile.currentStreak;
    const flame = document.getElementById('streak-flame');
    const s = this.profile.currentStreak;
    if (s >= 30) flame.textContent = '✨🔥✨';
    else if (s >= 14) flame.textContent = '🔥🔥🔥';
    else if (s >= 7) flame.textContent = '🔥🔥';
    else if (s >= 3) flame.textContent = '🔥';
    else flame.textContent = '🕯️';

    const nextLevel = this.getNextLevel();
    const prevKP = level.kpRequired;
    const nextKP = nextLevel ? nextLevel.kpRequired : level.kpRequired;
    const progress = nextLevel ? ((this.profile.totalKP - prevKP) / (nextKP - prevKP)) * 100 : 100;
    document.getElementById('xp-bar-fill').style.width = `${Math.min(100, Math.max(3, progress))}%`;
    document.getElementById('xp-bar-text').textContent = nextLevel
      ? `Lvl ${level.level} • ${this.profile.totalKP}/${nextKP} KP`
      : `Lvl ${level.level} • MAX ✨`;
  }

  renderActivities() {
    const s = this.settings, d = this.dailyLog;
    const locked = this.isDayLocked();

    // Toggle visibility based on Admin settings
    document.getElementById('navkarsi-card').style.display = s.enableNavkarsi ? 'flex' : 'none';
    document.getElementById('wakeup-card').style.display = s.enableWakeup ? 'flex' : 'none';
    document.getElementById('sleep-card').style.display = s.enableSleep ? 'flex' : 'none';
    document.getElementById('pranam-card').style.display = s.enablePranam ? 'flex' : 'none';
    document.getElementById('pooja-card').style.display = s.enablePooja ? 'flex' : 'none';
    document.getElementById('samayik-card').style.display = s.enableSamayik ? 'flex' : 'none';
    document.getElementById('pratikraman-card').style.display = s.enablePratikraman ? 'flex' : 'none';
    document.getElementById('book-card').style.display = s.enableBookReading ? 'flex' : 'none';
    document.getElementById('ratribhojan-card').style.display = s.enableRatriBhojan ? 'flex' : 'none';
    document.getElementById('kandmool-card').style.display = s.enableKandmool ? 'flex' : 'none';
    document.getElementById('screentime-card').style.display = s.enableScreenTime ? 'flex' : 'none';
    document.getElementById('niyam-card').style.display = s.enableDailyNiyam ? 'block' : 'none';

    const checkCat = (catId, toggles) => {
      document.getElementById(catId).style.display = toggles.some(t => t) ? 'block' : 'none';
    };
    checkCat('cat-morning', [s.enableNavkarsi, s.enableWakeup, s.enableSleep, s.enablePranam]);
    checkCat('cat-sadhana', [s.enablePooja, s.enableSamayik, s.enablePratikraman, s.enableBookReading]);
    checkCat('cat-tyag', [s.enableRatriBhojan, s.enableKandmool, s.enableScreenTime, s.enableDailyNiyam]);

    const updateSimpleCard = (id, isDone) => {
      const card = document.getElementById(`${id}-card`);
      const btn = document.getElementById(`btn-${id}`);
      const btnUndo = document.getElementById(`btn-${id}-undo`);
      if (!card || !btn || !btnUndo) return;
      if (isDone) {
        card.classList.add('completed');
        btn.classList.add('hidden');
        if (!locked) btnUndo.classList.remove('hidden');
      } else {
        card.classList.remove('completed');
        btn.classList.remove('hidden');
        btnUndo.classList.add('hidden');
      }
      btn.disabled = locked;
    };

    updateSimpleCard('navkarsi', d.navkarsiDone);
    updateSimpleCard('wakeup', d.wakeUpDone);
    updateSimpleCard('sleep', d.sleepDone);
    updateSimpleCard('pranam', d.pranamDone);
    updateSimpleCard('ratribhojan', d.ratriBhojanDone);
    updateSimpleCard('kandmool', d.kandmoolDone);

    // Pooja
    updateSimpleCard('pooja', d.poojaDone);
    const ashtaCheck = document.getElementById('ashta-checkbox');
    if (ashtaCheck) {
      ashtaCheck.checked = d.ashtaPrakariDone || false;
      ashtaCheck.disabled = locked;
    }

    // Counters
    const updateCounterCard = (id, count) => {
      const elCount = document.getElementById(`${id}-count`);
      if (elCount) elCount.textContent = count;
      const cCard = document.getElementById(`${id}-card`);
      if (!cCard) return;
      if (count > 0) cCard.classList.add('completed');
      else cCard.classList.remove('completed');
      const btnMinus = document.getElementById(`btn-${id}-minus`);
      if (btnMinus) btnMinus.disabled = locked || count <= 0;
      const btnPlus = document.getElementById(`btn-${id}-plus`);
      if (btnPlus) btnPlus.disabled = locked;
    };
    updateCounterCard('samayik', d.samayikDone || 0);
    updateCounterCard('pratikraman', d.pratikramanDone || 0);
    updateCounterCard('book', Math.floor((d.bookReadingMins || 0) / 30));

    // Screen Time
    const stH = d.screenTimeHours || 0;
    const stM = d.screenTimeMins || 0;
    const stCard = document.getElementById('screentime-card');
    if (stCard) {
      document.getElementById('screen-h-count').textContent = `${stH}h`;
      document.getElementById('screen-m-count').textContent = `${stM}m`;
      if (stH > 0 || stM > 0) stCard.classList.add('completed');
      else stCard.classList.remove('completed');
      
      document.getElementById('btn-screen-h-minus').disabled = locked || stH <= 0;
      document.getElementById('btn-screen-h-plus').disabled = locked;
      document.getElementById('btn-screen-m-minus').disabled = locked || stM <= 0;
      document.getElementById('btn-screen-m-plus').disabled = locked;
    }

    // Niyam
    updateSimpleCard('niyam', d.dailyNiyamDone);
  }

  getTotalTasksCount() {
    const s = this.settings;
    let total = 0;
    if (s.enableNavkarsi) total++;
    if (s.enableWakeup) total++;
    if (s.enableSleep) total++;
    if (s.enablePranam) total++;
    if (s.enablePooja) total++;
    if (s.enableSamayik) total++;
    if (s.enablePratikraman) total++;
    if (s.enableBookReading) total++;
    if (s.enableRatriBhojan) total++;
    if (s.enableKandmool) total++;
    if (s.enableDailyNiyam) total++;
    return total;
  }

  renderDailyProgress() {
    const total = this.getTotalTasksCount() || 1; // Prevent div by 0
    const completed = this.getCompletedCount();
    const pct = (completed / total) * 100;
    document.getElementById('daily-progress-text').textContent = `${completed}/${total} Complete`;
    const fill = document.getElementById('daily-progress-fill');
    fill.style.width = `${pct}%`;
    fill.classList.toggle('perfect', completed >= total);
    document.getElementById('daily-kp').textContent = `+${this.dailyLog.kpEarned || 0} KP earned today`;
  }

  renderNiyam() {
    const niyamId = this.settings.currentDailyNiyamId || 0;
    document.getElementById('niyam-text').textContent = PACHCHAKHANS[niyamId];
  }

  renderMotivation() {
    const completed = this.getCompletedCount();
    const total = this.getTotalTasksCount();
    let pool;
    if (completed >= total && total > 0) pool = MOTIVATIONAL_MESSAGES.complete;
    else if (completed > 0) pool = MOTIVATIONAL_MESSAGES.progress;
    else pool = MOTIVATIONAL_MESSAGES.morning;
    document.getElementById('motivation-text').textContent = pool[Math.floor(Math.random() * pool.length)];
    document.getElementById('social-proof').textContent = MOTIVATIONAL_MESSAGES.socialProof[Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.socialProof.length)];
  }

  updateProgressRing(ringId, progress) {
    const ring = document.getElementById(ringId);
    if (!ring) return;
    ring.style.strokeDashoffset = 213.6 * (1 - Math.min(1, progress));
  }

  // ===== ACTIVITY ACTIONS (REVERSIBLE) =====

  toggleSimpleActivity(elId, prop, isDone, points) {
    if (this.isDayLocked()) return;
    if (this.dailyLog[prop] === isDone) return;
    this.dailyLog[prop] = isDone;
    
    let actualPoints = this.applyStreakMultiplier(points);
    if (isDone) {
      this.addKarmaPoints(actualPoints, elId);
      this.showCompletionBurst(document.getElementById(`${elId}-card`));
      // Track lifetime stats
      this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;
      if (prop === 'dailyNiyamDone') this.profile.totalNiyam = (this.profile.totalNiyam || 0) + 1;
    } else {
      this.deductKarmaPoints(actualPoints);
      if (prop === 'dailyNiyamDone') this.profile.totalNiyam = Math.max(0, (this.profile.totalNiyam || 0) - 1);
      if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
        this.dailyLog.perfectDay = false;
        this.deductKarmaPoints(POINTS.perfectDay);
      }
    }
    this.afterActivity();
  }

  completePooja() {
    if (this.isDayLocked() || this.dailyLog.poojaDone) return;
    this.dailyLog.poojaDone = true;
    let points = this.applyStreakMultiplier(POINTS.pooja);
    if (this.dailyLog.ashtaPrakariDone) points += POINTS.ashtaPrakari; 
    this.addKarmaPoints(points, 'Pooja');
    this.showCompletionBurst(document.getElementById('pooja-card'));
    this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;
    // Track early pooja (before 8 AM)
    if (new Date().getHours() < 8) this.profile.earlyPooja = (this.profile.earlyPooja || 0) + 1;
    this.afterActivity();
  }

  undoPooja() {
    if (this.isDayLocked() || !this.dailyLog.poojaDone) return;
    this.dailyLog.poojaDone = false;
    let points = this.applyStreakMultiplier(POINTS.pooja);
    if (this.dailyLog.ashtaPrakariDone) points += POINTS.ashtaPrakari;
    this.deductKarmaPoints(points);
    if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
      this.dailyLog.perfectDay = false;
      this.deductKarmaPoints(POINTS.perfectDay);
    }
    this.afterActivity();
  }

  toggleAshtaPrakari() {
    if (this.isDayLocked()) return;
    this.dailyLog.ashtaPrakariDone = document.getElementById('ashta-checkbox').checked;
    if (this.dailyLog.poojaDone) {
      if (this.dailyLog.ashtaPrakariDone) {
        this.addKarmaPoints(POINTS.ashtaPrakari, 'Ashta Prakari');
      } else {
        this.deductKarmaPoints(POINTS.ashtaPrakari);
      }
    }
    this.saveDailyLog();
  }

  adjustCounter(prop, delta, pointsPerUnit, elId) {
    if (this.isDayLocked()) return;
    const oldVal = this.dailyLog[prop] || 0;
    const newVal = Math.max(0, oldVal + delta);
    if (oldVal === newVal) return;
    this.dailyLog[prop] = newVal;
    
    const points = this.applyStreakMultiplier(pointsPerUnit);
    
    if (delta > 0) {
      this.addKarmaPoints(points, elId);
      this.showCompletionBurst(document.getElementById(`${elId}-card`));
      // Track lifetime stats for counters
      this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;
      if (prop === 'samayikDone') this.profile.totalSamayik = (this.profile.totalSamayik || 0) + 1;
      if (prop === 'pratikramanDone') {
        this.profile.totalPratikraman = (this.profile.totalPratikraman || 0) + 1;
        this.profile.totalFullPratikraman = (this.profile.totalFullPratikraman || 0) + 1;
      }
      if (prop === 'bookReadingMins') this.profile.totalSwadhyay = (this.profile.totalSwadhyay || 0) + 1;
    } else {
      this.deductKarmaPoints(points);
      // Reverse lifetime stats
      if (prop === 'samayikDone') this.profile.totalSamayik = Math.max(0, (this.profile.totalSamayik || 0) - 1);
      if (prop === 'pratikramanDone') {
        this.profile.totalPratikraman = Math.max(0, (this.profile.totalPratikraman || 0) - 1);
        this.profile.totalFullPratikraman = Math.max(0, (this.profile.totalFullPratikraman || 0) - 1);
      }
      if (prop === 'bookReadingMins') this.profile.totalSwadhyay = Math.max(0, (this.profile.totalSwadhyay || 0) - 1);
      if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
        this.dailyLog.perfectDay = false;
        this.deductKarmaPoints(POINTS.perfectDay);
      }
    }
    this.afterActivity();
  }

  adjustScreenTime(prop, delta) {
    if (this.isDayLocked()) return;
    const oldVal = this.dailyLog[prop] || 0;
    const newVal = Math.max(0, oldVal + delta);
    if (oldVal === newVal) return;
    
    const hOld = this.dailyLog.screenTimeHours || 0;
    const mOld = this.dailyLog.screenTimeMins || 0;
    const totalMinsOld = (hOld * 60) + mOld;
    
    this.dailyLog[prop] = newVal;
    
    const hNew = this.dailyLog.screenTimeHours || 0;
    const mNew = this.dailyLog.screenTimeMins || 0;
    const totalMinsNew = (hNew * 60) + mNew;
    
    const hoursOld = Math.floor(totalMinsOld / 60);
    const hoursNew = Math.floor(totalMinsNew / 60);
    
    if (hoursNew > hoursOld) {
      const diff = hoursNew - hoursOld;
      this.deductKarmaPoints(diff * POINTS.screenTimePenalty);
    } else if (hoursNew < hoursOld) {
      const diff = hoursOld - hoursNew;
      this.addKarmaPoints(diff * POINTS.screenTimePenalty, 'Screen Time Reverted');
    }
    
    this.afterActivity();
  }

  afterActivity() {
    this.checkPerfectDay();
    this.checkBadges();
    this.saveDailyLog();
    this.saveProfile();
    this.renderDashboard();
  }

  // ===== GAMIFICATION ENGINE =====
  getCurrentLevel() {
    let current = LEVELS[0];
    for (const level of LEVELS) {
      if (this.profile.totalKP >= level.kpRequired) current = level;
    }
    return current;
  }

  getNextLevel() {
    return LEVELS.find(l => l.kpRequired > this.profile.totalKP) || null;
  }

  addKarmaPoints(points, reason) {
    const prevLevel = this.getCurrentLevel();
    this.profile.totalKP += points;
    this.dailyLog.kpEarned = (this.dailyLog.kpEarned || 0) + points;
    this.showKPPopup(points);

    const newLevel = this.getCurrentLevel();
    if (newLevel.level > prevLevel.level) this.showLevelUp(newLevel);
  }

  deductKarmaPoints(points) {
    this.profile.totalKP = Math.max(0, this.profile.totalKP - points);
    this.dailyLog.kpEarned = Math.max(0, (this.dailyLog.kpEarned || 0) - points);
    this.showKPPopup(-points);
  }

  applyStreakMultiplier(points) {
    const s = this.profile.currentStreak;
    let m = 1;
    if (s >= 30) m = 3;
    else if (s >= 14) m = 2.5;
    else if (s >= 7) m = 2;
    else if (s >= 3) m = 1.5;
    return Math.round(points * m);
  }

  updateStreak(wasComplete) {
    if (wasComplete) {
      this.profile.currentStreak += 1;
      if (this.profile.currentStreak > this.profile.longestStreak) {
        this.profile.longestStreak = this.profile.currentStreak;
      }
    } else {
      const now = new Date();
      const month = `${now.getFullYear()}-${now.getMonth()}`;
      if (this.profile.currentStreak >= 7 && !this.profile.streakFreezeUsed && this.profile.streakFreezeMonth !== month) {
        this.profile.streakFreezeUsed = true;
        this.profile.streakFreezeMonth = month;
      } else {
        this.profile.currentStreak = 0;
        this.profile.streakFreezeUsed = false;
      }
    }
    this.saveProfile();
  }

  checkPerfectDay() {
    if (this.isAllTasksComplete() && !this.dailyLog.perfectDay) {
      this.dailyLog.perfectDay = true;
      this.profile.totalPerfectDays = (this.profile.totalPerfectDays || 0) + 1;
      this.addKarmaPoints(POINTS.perfectDay, 'Perfect Day! 🎊');
    }
  }

  isAllTasksComplete() {
    const d = this.dailyLog, s = this.settings;
    if (s.enableNavkarsi && !d.navkarsiDone) return false;
    if (s.enableWakeup && !d.wakeUpDone) return false;
    if (s.enableSleep && !d.sleepDone) return false;
    if (s.enablePranam && !d.pranamDone) return false;
    if (s.enablePooja && !d.poojaDone) return false;
    if (s.enableSamayik && (d.samayikDone || 0) < parseInt(s.samayikTarget)) return false;
    if (s.enablePratikraman && (d.pratikramanDone || 0) < parseInt(s.pratikramanTarget)) return false;
    if (s.enableBookReading && (d.bookReadingMins || 0) < 30) return false;
    if (s.enableRatriBhojan && !d.ratriBhojanDone) return false;
    if (s.enableKandmool && !d.kandmoolDone) return false;
    if (s.enableDailyNiyam && !d.dailyNiyamDone) return false;
    return true;
  }

  getCompletedCount() {
    const d = this.dailyLog, s = this.settings;
    let c = 0;
    if (s.enableNavkarsi && d.navkarsiDone) c++;
    if (s.enableWakeup && d.wakeUpDone) c++;
    if (s.enableSleep && d.sleepDone) c++;
    if (s.enablePranam && d.pranamDone) c++;
    if (s.enablePooja && d.poojaDone) c++;
    if (s.enableSamayik && (d.samayikDone || 0) >= parseInt(s.samayikTarget)) c++;
    if (s.enablePratikraman && (d.pratikramanDone || 0) >= parseInt(s.pratikramanTarget)) c++;
    if (s.enableBookReading && (d.bookReadingMins || 0) >= 30) c++;
    if (s.enableRatriBhojan && d.ratriBhojanDone) c++;
    if (s.enableKandmool && d.kandmoolDone) c++;
    if (s.enableDailyNiyam && d.dailyNiyamDone) c++;
    return c;
  }

  checkBadges() {
    const p = this.profile;
    for (const badge of BADGES) {
      if (p.badges && p.badges.includes(badge.id)) continue;
      let earned = false;
      switch (badge.condition) {
        case 'earlyPooja': earned = (p.earlyPooja || 0) >= badge.threshold; break;
        case 'streak': earned = p.currentStreak >= badge.threshold; break;
        case 'totalSwadhyay': earned = (p.totalSwadhyay || 0) >= badge.threshold; break;
        case 'totalSamayik': earned = (p.totalSamayik || 0) >= badge.threshold; break;
        case 'perfectDays': earned = (p.totalPerfectDays || 0) >= badge.threshold; break;
        case 'totalKP': earned = p.totalKP >= badge.threshold; break;
        case 'level': earned = this.getCurrentLevel().level >= badge.threshold; break;
        case 'totalFullPratikraman': earned = (p.totalFullPratikraman || 0) >= badge.threshold; break;
        case 'totalNiyam': earned = (p.totalNiyam || 0) >= badge.threshold; break;
        case 'totalActivities': earned = (p.totalActivities || 0) >= badge.threshold; break;
        case 'dailyKP': earned = (this.dailyLog.kpEarned || 0) >= badge.threshold; break;
      }
      if (earned) {
        if (!p.badges) p.badges = [];
        p.badges.push(badge.id);
        this.pendingBadges.push(badge);
        this.saveProfile();
      }
    }
    if (this.pendingBadges.length > 0) {
      setTimeout(() => this.showNextBadge(), 800);
    }
  }

  showNextBadge() {
    if (this.pendingBadges.length === 0) return;
    this.showBadgeUnlock(this.pendingBadges.shift());
  }

  checkStreakWarning() {
    if (this.profile.currentStreak >= 3 && !this.isAllTasksComplete() && new Date().getHours() >= 18) {
      const el = document.getElementById('motivation-text');
      if (el) el.textContent = MOTIVATIONAL_MESSAGES.streakRisk[Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.streakRisk.length)];
    }
  }

  // ===== ANIMATIONS =====
  showKPPopup(points) {
    const popup = document.getElementById('kp-popup');
    popup.textContent = points >= 0 ? `+${points} KP` : `${points} KP`;
    popup.className = points >= 0 ? 'kp-popup show' : 'kp-popup show kp-negative';
    setTimeout(() => { popup.className = 'kp-popup hidden'; }, 1500);
  }

  showCompletionBurst(element) {
    if (!element) return;
    element.classList.add('completing');
    setTimeout(() => element.classList.remove('completing'), 600);
    const rect = element.getBoundingClientRect();
    const container = document.getElementById('burst-container');
    const colors = ['#FFD700', '#FF9933', '#E8722A', '#6B9E6B', '#FF6B35'];
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'burst-particle';
      const angle = (i / 12) * 360;
      const dist = 50 + Math.random() * 60;
      p.style.left = `${rect.left + rect.width / 2}px`;
      p.style.top = `${rect.top + rect.height / 2}px`;
      p.style.setProperty('--dx', `${Math.cos(angle * Math.PI / 180) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle * Math.PI / 180) * dist}px`);
      p.style.backgroundColor = colors[i % colors.length];
      container.appendChild(p);
      setTimeout(() => p.remove(), 700);
    }
  }

  showBonus(elementId, text) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2000);
  }

  showLevelUp(level) {
    document.getElementById('level-up-icon').textContent = level.icon;
    document.getElementById('level-up-name').textContent = `You are now a ${level.title}!`;
    document.getElementById('level-up-unlock').textContent = level.unlock;
    const overlay = document.getElementById('level-up-overlay');
    overlay.classList.remove('hidden');
    overlay.classList.add('show');
    this.createConfetti(overlay);
    this.renderAchievements();
  }

  closeLevelUp() {
    const o = document.getElementById('level-up-overlay');
    o.classList.remove('show'); o.classList.add('hidden');
    this.renderHeader();
  }

  showBadgeUnlock(badge) {
    document.getElementById('badge-unlock-icon').textContent = badge.icon;
    document.getElementById('badge-unlock-name').textContent = badge.name;
    document.getElementById('badge-unlock-desc').textContent = badge.desc;
    const r = document.getElementById('badge-unlock-rarity');
    r.textContent = badge.rarity; r.style.color = RARITY_COLORS[badge.rarity] || '#666';
    const o = document.getElementById('badge-unlock-overlay');
    o.classList.remove('hidden'); o.classList.add('show');
    this.renderAchievements();
  }

  closeBadgeUnlock() {
    const o = document.getElementById('badge-unlock-overlay');
    o.classList.remove('show'); o.classList.add('hidden');
    setTimeout(() => this.showNextBadge(), 300);
  }

  closeEveningSummary() {
    const o = document.getElementById('evening-summary-overlay');
    o.classList.remove('show'); o.classList.add('hidden');
  }

  createConfetti(container) {
    const colors = ['#FFD700', '#FF9933', '#E8722A', '#6B9E6B', '#FF6B35', '#7B2D8E', '#F1C40F'];
    for (let i = 0; i < 40; i++) {
      const c = document.createElement('div');
      c.className = 'confetti-piece';
      c.style.left = `${Math.random() * 100}%`;
      c.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      c.style.animationDelay = `${Math.random()}s`;
      c.style.animationDuration = `${1.5 + Math.random() * 2}s`;
      container.appendChild(c);
      setTimeout(() => c.remove(), 4000);
    }
  }

  // ===== ACHIEVEMENTS TAB =====
  renderAchievements() {
    document.getElementById('stat-total-kp').textContent = this.profile.totalKP;
    document.getElementById('stat-longest-streak').textContent = this.profile.longestStreak;
    document.getElementById('stat-total-samayik').textContent = this.profile.totalSamayik || 0;
    document.getElementById('stat-total-swadhyay').textContent = this.profile.totalSwadhyay || 0;
    document.getElementById('stat-total-pratikraman').textContent = this.profile.totalPratikraman || 0;
    document.getElementById('stat-perfect-days').textContent = this.profile.totalPerfectDays || 0;

    const grid = document.getElementById('badges-grid');
    grid.innerHTML = '';
    for (const badge of BADGES) {
      const earned = this.profile.badges && this.profile.badges.includes(badge.id);
      const item = document.createElement('div');
      item.className = `badge-item ${earned ? 'earned' : 'locked'}`;
      item.innerHTML = `
        <div class="badge-icon-circle" style="border-color: ${earned ? RARITY_COLORS[badge.rarity] : '#ccc'}">
          <span class="badge-icon">${earned ? badge.icon : '🔒'}</span>
        </div>
        <span class="badge-name">${earned ? badge.name : '???'}</span>
        <span class="badge-rarity" style="color: ${RARITY_COLORS[badge.rarity]}">${badge.rarity}</span>`;
      grid.appendChild(item);
    }

    const journey = document.getElementById('level-journey');
    journey.innerHTML = '';
    const curLevel = this.getCurrentLevel();
    for (const level of LEVELS) {
      const reached = this.profile.totalKP >= level.kpRequired;
      const node = document.createElement('div');
      node.className = `journey-node ${reached ? 'reached' : ''} ${level.level === curLevel.level ? 'current' : ''}`;
      node.innerHTML = `<div class="journey-dot">${level.icon}</div><div class="journey-info"><span class="journey-title">${level.title}</span><span class="journey-subtitle">${level.subtitle} • ${level.kpRequired} KP</span></div>`;
      journey.appendChild(node);
    }
  }

  // ===== HISTORY =====
  _initHistoryState() {
    if (this._historyMonth === undefined) {
      const now = new Date();
      this._historyMonth = now.getMonth();
      this._historyYear = now.getFullYear();
    }
  }

  _initAdminHistoryState() {
    if (!this._adminHistoryMonth && this._adminHistoryMonth !== 0) {
      const now = new Date();
      this._adminHistoryMonth = now.getMonth();
      this._adminHistoryYear = now.getFullYear();
    }
  }

  async renderHistory() {
    this._initHistoryState();
    const listEl = document.getElementById('history-list');
    const labelEl = document.getElementById('history-month-label');
    if (!listEl || !labelEl) return;

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    labelEl.textContent = `${monthNames[this._historyMonth]} ${this._historyYear}`;

    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#795548;">Loading...</div>';

    try {
      const snap = await db.ref(`users/${this.uid}/daily_logs`).once('value');
      const allLogs = snap.val() || {};
      this._renderHistoryDays(listEl, allLogs, this._historyYear, this._historyMonth);
    } catch (e) {
      listEl.innerHTML = '<div style="text-align:center; color:red;">Failed to load history.</div>';
    }
  }

  async renderAdminHistory() {
    this._initAdminHistoryState();
    const listEl = document.getElementById('admin-history-list');
    const labelEl = document.getElementById('admin-history-month-label');
    if (!listEl || !labelEl) return;

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    labelEl.textContent = `${monthNames[this._adminHistoryMonth]} ${this._adminHistoryYear}`;

    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#795548;">Loading...</div>';

    try {
      const snap = await db.ref(`users/${this.uid}/daily_logs`).once('value');
      const allLogs = snap.val() || {};
      this._renderHistoryDays(listEl, allLogs, this._adminHistoryYear, this._adminHistoryMonth);
    } catch (e) {
      listEl.innerHTML = '<div style="text-align:center; color:red;">Failed to load history.</div>';
    }
  }

  _renderHistoryDays(container, allLogs, year, month) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = this.getTodayKey();
    const s = this.settings || DEFAULT_SETTINGS;
    let html = '';

    for (let day = daysInMonth; day >= 1; day--) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dateKey > today) continue; // skip future dates

      const log = allLogs[dateKey];
      if (!log) {
        html += `<div class="history-day history-empty">
          <div class="history-date">${this._formatHistoryDate(dateKey)}</div>
          <div class="history-summary">No data recorded</div>
        </div>`;
        continue;
      }

      // Count completed activities
      let done = 0, total = 0;
      const checks = [
        { enabled: s.enableNavkarsi, val: log.navkarsiDone },
        { enabled: s.enableWakeup, val: log.wakeUpDone },
        { enabled: s.enableSleep, val: log.sleepDone },
        { enabled: s.enablePranam, val: log.pranamDone },
        { enabled: s.enablePooja, val: log.poojaDone },
        { enabled: s.enableSamayik, val: (log.samayikDone || 0) >= parseInt(s.samayikTarget || 1) },
        { enabled: s.enablePratikraman, val: (log.pratikramanDone || 0) >= parseInt(s.pratikramanTarget || 1) },
        { enabled: s.enableBookReading, val: (log.bookReadingMins || 0) >= 30 },
        { enabled: s.enableRatriBhojan, val: log.ratriBhojanDone },
        { enabled: s.enableKandmool, val: log.kandmoolDone },
        { enabled: s.enableDailyNiyam, val: log.dailyNiyamDone },
      ];
      checks.forEach(c => { if (c.enabled) { total++; if (c.val) done++; } });

      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const kp = log.kpEarned || 0;
      const isPerfect = log.perfectDay;
      const statusClass = isPerfect ? 'history-perfect' : (pct >= 50 ? 'history-good' : 'history-low');

      // Build mini activity icons
      const icons = [];
      if (s.enableNavkarsi && log.navkarsiDone) icons.push('🌅');
      if (s.enableWakeup && log.wakeUpDone) icons.push('⏰');
      if (s.enablePooja && log.poojaDone) icons.push('🪔');
      if (s.enableSamayik && (log.samayikDone || 0) > 0) icons.push('🧘');
      if (s.enablePratikraman && (log.pratikramanDone || 0) > 0) icons.push('🙏');
      if (s.enableBookReading && (log.bookReadingMins || 0) >= 30) icons.push('📖');
      if (s.enableRatriBhojan && log.ratriBhojanDone) icons.push('🍽️');
      if (s.enableKandmool && log.kandmoolDone) icons.push('🌱');
      if (s.enableDailyNiyam && log.dailyNiyamDone) icons.push('✨');

      html += `<div class="history-day ${statusClass}">
        <div class="history-date">${this._formatHistoryDate(dateKey)}${isPerfect ? ' ⭐' : ''}</div>
        <div class="history-bar-wrap">
          <div class="history-bar" style="width:${pct}%"></div>
        </div>
        <div class="history-meta">
          <span class="history-pct">${done}/${total} (${pct}%)</span>
          <span class="history-kp">+${kp} KP</span>
        </div>
        <div class="history-icons">${icons.join(' ')}</div>
      </div>`;
    }

    container.innerHTML = html || '<div style="text-align:center; padding:20px; color:#795548;">No history for this month.</div>';
  }

  _formatHistoryDate(dateKey) {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const d = new Date(dateKey + 'T00:00:00');
    return `${days[d.getDay()]}, ${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;
  }

  _changeHistoryMonth(delta, isAdmin) {
    if (isAdmin) {
      this._initAdminHistoryState();
      this._adminHistoryMonth += delta;
      if (this._adminHistoryMonth > 11) { this._adminHistoryMonth = 0; this._adminHistoryYear++; }
      if (this._adminHistoryMonth < 0) { this._adminHistoryMonth = 11; this._adminHistoryYear--; }
      this.renderAdminHistory();
    } else {
      this._initHistoryState();
      this._historyMonth += delta;
      if (this._historyMonth > 11) { this._historyMonth = 0; this._historyYear++; }
      if (this._historyMonth < 0) { this._historyMonth = 11; this._historyYear--; }
      this.renderHistory();
    }
  }

  // ===== NAVIGATION =====
  switchTab(tabName) {
    document.querySelectorAll('#app .tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    document.querySelector(`#bottom-nav .nav-item[data-tab="${tabName}"]`).classList.add('active');
    if (tabName === 'achievements') this.renderAchievements();
    if (tabName === 'history') this.renderHistory();
  }

  switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#admin-bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`admin-tab-${tabName.replace('admin-', '')}`).classList.add('active');
    document.querySelector(`#admin-bottom-nav .nav-item[data-tab="${tabName}"]`).classList.add('active');
    if (tabName === 'admin-progress') this.renderAdminProgress();
    if (tabName === 'admin-lock') this.renderAdminLock();
    if (tabName === 'admin-leaderboard') this.renderAdminLeaderboard();
  }

  // ===== ADMIN FUNCTIONS =====
  loadAdminSettingsUI() {
    const s = this.settings;
    document.getElementById('admin-toggle-navkarsi').checked = s.enableNavkarsi;
    document.getElementById('admin-toggle-wakeup').checked = s.enableWakeup;
    document.getElementById('admin-toggle-sleep').checked = s.enableSleep;
    document.getElementById('admin-toggle-pranam').checked = s.enablePranam;
    document.getElementById('admin-toggle-pooja').checked = s.enablePooja;
    document.getElementById('admin-toggle-samayik').checked = s.enableSamayik;
    document.getElementById('admin-toggle-pratikraman').checked = s.enablePratikraman;
    document.getElementById('admin-toggle-book').checked = s.enableBookReading;
    document.getElementById('admin-toggle-ratribhojan').checked = s.enableRatriBhojan;
    document.getElementById('admin-toggle-kandmool').checked = s.enableKandmool;
    document.getElementById('admin-toggle-screentime').checked = s.enableScreenTime;
    document.getElementById('admin-toggle-niyam').checked = s.enableDailyNiyam;

    const niyamSelect = document.getElementById('admin-select-niyam');
    niyamSelect.innerHTML = '';
    PACHCHAKHANS.forEach((niyam, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = niyam;
      niyamSelect.appendChild(opt);
    });
    niyamSelect.value = s.currentDailyNiyamId || 0;

    // admin-location removed
  }

  saveAdminSettings() {
    const s = this.settings;
    s.enableNavkarsi = document.getElementById('admin-toggle-navkarsi').checked;
    s.enableWakeup = document.getElementById('admin-toggle-wakeup').checked;
    s.enableSleep = document.getElementById('admin-toggle-sleep').checked;
    s.enablePranam = document.getElementById('admin-toggle-pranam').checked;
    s.enablePooja = document.getElementById('admin-toggle-pooja').checked;
    s.enableSamayik = document.getElementById('admin-toggle-samayik').checked;
    s.enablePratikraman = document.getElementById('admin-toggle-pratikraman').checked;
    s.enableBookReading = document.getElementById('admin-toggle-book').checked;
    s.enableRatriBhojan = document.getElementById('admin-toggle-ratribhojan').checked;
    s.enableKandmool = document.getElementById('admin-toggle-kandmool').checked;
    s.enableScreenTime = document.getElementById('admin-toggle-screentime').checked;
    s.enableDailyNiyam = document.getElementById('admin-toggle-niyam').checked;
    s.currentDailyNiyamId = parseInt(document.getElementById('admin-select-niyam').value);

    // Location removed from admin UI - fetched via Geolocation
    this.saveSettings();
    const conf = document.getElementById('save-confirmation');
    conf.classList.remove('hidden');
    setTimeout(() => conf.classList.add('hidden'), 2000);
  }

  renderAdminProgress() {
    const p = this.profile, d = this.dailyLog, s = this.settings;

    // Level
    const level = this.getCurrentLevel();
    document.getElementById('admin-user-level-icon').textContent = level.icon;
    document.getElementById('admin-user-level').textContent = `${level.title} (Lvl ${level.level})`;
    document.getElementById('admin-user-kp').textContent = `${p.totalKP} KP`;
    document.getElementById('admin-user-streak').textContent = `${p.currentStreak} day streak`;
    const flame = document.getElementById('admin-user-streak-flame');
    const st = p.currentStreak;
    if (st >= 30) flame.textContent = '✨🔥✨';
    else if (st >= 14) flame.textContent = '🔥🔥🔥';
    else if (st >= 7) flame.textContent = '🔥🔥';
    else if (st >= 3) flame.textContent = '🔥';
    else flame.textContent = '🕯️';

    // Today's activities — build dynamically from enabled settings
    const grid = document.getElementById('admin-today-grid');
    if (grid) {
      const activities = [
        { key: 'enableNavkarsi', icon: '🚰', name: 'Navkarsi', status: d.navkarsiDone ? '✓' : '✗', done: !!d.navkarsiDone },
        { key: 'enableWakeup', icon: '🌅', name: 'Wake < 7AM', status: d.wakeUpDone ? '✓' : '✗', done: !!d.wakeUpDone },
        { key: 'enableSleep', icon: '🌙', name: 'Sleep < 12AM', status: d.sleepDone ? '✓' : '✗', done: !!d.sleepDone },
        { key: 'enablePranam', icon: '🙇', name: 'Pranam', status: d.pranamDone ? '✓' : '✗', done: !!d.pranamDone },
        { key: 'enablePooja', icon: '🪔', name: 'Pooja', status: d.poojaDone ? (d.ashtaPrakariDone ? '✓ +Ashta' : '✓') : '✗', done: !!d.poojaDone },
        { key: 'enableSamayik', icon: '🧘', name: 'Samayik', status: `${d.samayikDone || 0}`, done: (d.samayikDone || 0) > 0 },
        { key: 'enablePratikraman', icon: '🙏', name: 'Pratikraman', status: `${d.pratikramanDone || 0}`, done: (d.pratikramanDone || 0) > 0 },
        { key: 'enableBookReading', icon: '📖', name: 'Book Reading', status: `${d.bookReadingMins || 0} min`, done: (d.bookReadingMins || 0) >= 30 },
        { key: 'enableRatriBhojan', icon: '🚫', name: 'Ratri Bhojan Tyag', status: d.ratriBhojanDone ? '✓' : '✗', done: !!d.ratriBhojanDone },
        { key: 'enableKandmool', icon: '🥔', name: 'Kandmool Tyag', status: d.kandmoolDone ? '✓' : '✗', done: !!d.kandmoolDone },
        { key: 'enableScreenTime', icon: '📱', name: 'Screen Time', status: `${d.screenTimeHours || 0}h ${d.screenTimeMins || 0}m`, done: false },
        { key: 'enableDailyNiyam', icon: '✨', name: 'Daily Niyam', status: d.dailyNiyamDone ? '✓' : '✗', done: !!d.dailyNiyamDone },
      ];
      grid.innerHTML = activities
        .filter(a => s[a.key])
        .map(a => `<div class="admin-activity-item"><span class="admin-act-icon">${a.icon}</span><span class="admin-act-name">${a.name}</span><span class="admin-act-status ${a.done ? 'done' : ''}">${a.status}</span></div>`)
        .join('');
    }

    // Lifetime stats
    document.getElementById('admin-stat-kp').textContent = p.totalKP;
    document.getElementById('admin-stat-streak').textContent = p.longestStreak;
    document.getElementById('admin-stat-samayik').textContent = p.totalSamayik || 0;
    document.getElementById('admin-stat-swadhyay').textContent = p.totalSwadhyay || 0;
    document.getElementById('admin-stat-pratikraman').textContent = p.totalPratikraman || 0;
    document.getElementById('admin-stat-perfect').textContent = p.totalPerfectDays || 0;

    // Badges
    const badgeList = document.getElementById('admin-badges-list');
    const earned = (p.badges || []).map(id => BADGES.find(b => b.id === id)).filter(Boolean);
    if (earned.length === 0) {
      badgeList.innerHTML = '<p class="admin-no-badges">No badges earned yet.</p>';
    } else {
      badgeList.innerHTML = earned.map(b => `<span class="admin-badge-chip" style="border-color:${RARITY_COLORS[b.rarity]}">${b.icon} ${b.name}</span>`).join(' ');
    }
  }

  renderAdminLock() {
    const locked = this.isDayLocked();
    const icon = document.getElementById('lock-status-icon');
    const text = document.getElementById('lock-status-text');
    const card = document.getElementById('lock-status-card');
    const btn = document.getElementById('btn-lock-day');

    if (locked) {
      icon.textContent = '🔒';
      text.innerHTML = 'Today is <strong>locked</strong>. User cannot modify activities.';
      card.classList.add('locked-state');
      btn.disabled = true;
      btn.textContent = '🔒 Already Locked';
    } else {
      icon.textContent = '🔓';
      text.innerHTML = 'Today is <strong>unlocked</strong>. User can still modify activities.';
      card.classList.remove('locked-state');
      btn.disabled = false;
      btn.textContent = '🔒 Lock Today\'s Submissions';
    }

    // Lock preview
    const d = this.dailyLog, s = this.settings;
    const preview = document.getElementById('lock-preview-list');
    const items = [
      s.enableNavkarsi ? `<div class="lock-preview-item"><span>🚰 Navkarsi:</span> <strong>${d.navkarsiDone ? '✓' : '✗'}</strong></div>` : '',
      s.enableWakeup ? `<div class="lock-preview-item"><span>🌅 Wake < 7AM:</span> <strong>${d.wakeUpDone ? '✓' : '✗'}</strong></div>` : '',
      s.enableSleep ? `<div class="lock-preview-item"><span>🌙 Sleep < 12AM:</span> <strong>${d.sleepDone ? '✓' : '✗'}</strong></div>` : '',
      s.enablePranam ? `<div class="lock-preview-item"><span>🙇 Pranam:</span> <strong>${d.pranamDone ? '✓' : '✗'}</strong></div>` : '',
      s.enablePooja ? `<div class="lock-preview-item"><span>🪔 Pooja:</span> <strong>${d.poojaDone ? 'Done' : 'Not done'}${d.ashtaPrakariDone ? ' +Ashta' : ''}</strong></div>` : '',
      s.enableSamayik ? `<div class="lock-preview-item"><span>🧘 Samayik:</span> <strong>${d.samayikDone || 0}</strong></div>` : '',
      s.enablePratikraman ? `<div class="lock-preview-item"><span>🙏 Pratikraman:</span> <strong>${d.pratikramanDone || 0}</strong></div>` : '',
      s.enableBookReading ? `<div class="lock-preview-item"><span>📖 Reading:</span> <strong>${d.bookReadingMins || 0} min</strong></div>` : '',
      s.enableRatriBhojan ? `<div class="lock-preview-item"><span>🚫 Ratri Bhojan:</span> <strong>${d.ratriBhojanDone ? '✓' : '✗'}</strong></div>` : '',
      s.enableKandmool ? `<div class="lock-preview-item"><span>🥔 Kandmool:</span> <strong>${d.kandmoolDone ? '✓' : '✗'}</strong></div>` : '',
      s.enableScreenTime ? `<div class="lock-preview-item"><span>📱 Screen:</span> <strong>${d.screenTimeHours || 0}h ${d.screenTimeMins || 0}m</strong></div>` : '',
      s.enableDailyNiyam ? `<div class="lock-preview-item"><span>✨ Niyam:</span> <strong>${d.dailyNiyamDone ? '✓' : '✗'}</strong></div>` : '',
    ];
    preview.innerHTML = items.filter(Boolean).join('');
  }

  adminLockDay() {
    if (this.isDayLocked()) return;
    if (confirm('🔒 Lock today\'s submissions? The user will no longer be able to modify today\'s activities. This cannot be undone.')) {
      this.lockDay();
      this.renderAdminLock();
      this.renderAdminProgress();
    }
  }

  // ===== LOGOUT =====
  logout() {
    Auth.signOut();
    this.currentRole = null;
    if (this.autoLockInterval) clearInterval(this.autoLockInterval);
    this._detachAllListeners();
    // Detach leaderboard listener
    if (this._leaderboardRef) {
      this._leaderboardRef.off('value', this._leaderboardListener);
      this._leaderboardRef = null;
    }
    // Detach global settings listener
    if (this._settingsRef) {
      this._settingsRef.off('value', this._settingsListener);
      this._settingsRef = null;
    }

    // Reset UI
    document.getElementById('app').classList.add('app-hidden');
    document.getElementById('app').classList.remove('app-visible');
    document.getElementById('admin-panel').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');

    // Clear form
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').classList.add('hidden');
  }

  resetProgress() {
    if (confirm('DANGER! This will delete all progress, points, and logs for this user. Are you sure?')) {
        db.ref(`users/${this.uid}/profile`).remove();
        db.ref(`users/${this.uid}/daily_logs`).remove();
        db.ref(`users/${this.uid}/lock_status`).remove().then(() => {
          alert('Progress reset successfully!');
          location.reload();
        });
    }
  }

  // ===== UTILITY =====
  getDayOfYear() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / (1000 * 60 * 60 * 24));
  }
}

// ===== INITIALIZE =====
document.addEventListener('DOMContentLoaded', () => {
  app = new KalyanMitra();
});
