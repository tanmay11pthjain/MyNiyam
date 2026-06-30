// ===== KALYAN MITRA V2 — CORE APPLICATION =====
// Auth-gated, admin-controlled, reversible submissions

let app; // Global reference

// ===== CITY COORDINATES =====
const CITIES = {
  bangalore: { lat: 12.9716, lng: 77.5946, name: 'Bangalore' },
  mumbai:    { lat: 19.0760, lng: 72.8777, name: 'Mumbai' },
  ahmedabad: { lat: 23.0225, lng: 72.5714, name: 'Ahmedabad' },
  delhi:     { lat: 28.7041, lng: 77.1025, name: 'Delhi' },
  jaipur:    { lat: 26.9124, lng: 75.7873, name: 'Jaipur' },
  kolkata:   { lat: 22.5726, lng: 88.3639, name: 'Kolkata' },
  chennai:   { lat: 13.0827, lng: 80.2707, name: 'Chennai' },
  pune:      { lat: 18.5204, lng: 73.8567, name: 'Pune' },
  surat:     { lat: 21.1702, lng: 72.8311, name: 'Surat' },
  udaipur:   { lat: 24.5854, lng: 73.7125, name: 'Udaipur' },
  palitana:  { lat: 21.5260, lng: 71.8230, name: 'Palitana' },
  indore:    { lat: 22.7196, lng: 75.8577, name: 'Indore' },
};

class KalyanMitra {
  constructor() {
    this.currentRole = null;
    this.pendingBadges = [];
    this.autoLockInterval = null;
    this.init();
  }

  // ===== INITIALIZATION =====
  async init() {
    const session = Auth.validateSession();
    if (session) {
      this.currentRole = session.role;
      document.getElementById('login-screen').classList.add('hidden');
      if (session.role === 'admin') {
        this.initAdmin();
      } else {
        this.initUser();
      }
    } else {
      this.showLoginScreen();
    }
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
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const btnEl = document.getElementById('btn-login');
    const loadingEl = document.getElementById('btn-login-loading');

    // Disable button during login
    btnEl.disabled = true;
    loadingEl.classList.remove('hidden');

    const result = await Auth.login(username, password);

    loadingEl.classList.add('hidden');
    btnEl.disabled = false;

    if (result.success) {
      errorEl.classList.add('hidden');
      this.currentRole = result.role;
      document.getElementById('login-screen').classList.add('hidden');
      if (result.role === 'admin') {
        this.initAdmin();
      } else {
        this.initUser();
      }
    } else {
      errorEl.textContent = result.error;
      errorEl.classList.remove('hidden');
      errorEl.classList.add('show');

      // Shake animation on error
      const card = document.querySelector('.login-card');
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 500);

      // Rate limit countdown
      if (result.rateLimited) {
        this.startRateLimitCountdown(errorEl);
      }
    }
  }

  startRateLimitCountdown(errorEl) {
    const interval = setInterval(() => {
      const remaining = Auth.getRateLimitRemaining();
      if (remaining <= 0) {
        errorEl.textContent = 'You can try again now.';
        setTimeout(() => errorEl.classList.add('hidden'), 2000);
        clearInterval(interval);
      } else {
        errorEl.textContent = `Too many attempts. Wait ${remaining}s...`;
      }
    }, 1000);
  }

  // ===== USER INITIALIZATION =====
  initUser() {
    this.settings = this.loadSettings();
    this.profile = this.loadProfile();
    this.dailyLog = this.loadDailyLog();

    document.getElementById('app').classList.remove('app-hidden');
    document.getElementById('app').classList.add('app-visible');
    document.getElementById('admin-panel').classList.add('hidden');

    this.checkDailyReset();
    this.calculatePanchang();
    this.grantDailyLogin();
    this.renderDashboard();
    this.renderAchievements();
    this.setupUserEventListeners();
    this.startAutoLockCheck();
    this.checkStreakWarning();
  }

  // ===== ADMIN INITIALIZATION =====
  initAdmin() {
    this.settings = this.loadSettings();
    this.profile = this.loadProfile();
    this.dailyLog = this.loadDailyLog();

    document.getElementById('admin-panel').classList.remove('hidden');
    document.getElementById('app').classList.add('app-hidden');
    document.getElementById('app').classList.remove('app-visible');

    this.loadAdminSettingsUI();
    this.renderAdminProgress();
    this.renderAdminLock();
    this.setupAdminEventListeners();
  }

  // ===== EVENT LISTENERS =====
  setupUserEventListeners() {
    // Activity buttons
    document.getElementById('btn-samayik').addEventListener('click', () => this.completeSamayik());
    document.getElementById('btn-samayik-undo').addEventListener('click', () => this.undoSamayik());
    document.getElementById('btn-pooja').addEventListener('click', () => this.completePooja());
    document.getElementById('btn-pooja-undo').addEventListener('click', () => this.undoPooja());
    document.getElementById('pakshal-checkbox').addEventListener('change', () => this.togglePakshal());
    document.getElementById('btn-swadhyay-minus').addEventListener('click', () => this.adjustSwadhyay(-1));
    document.getElementById('btn-swadhyay-plus').addEventListener('click', () => this.adjustSwadhyay(1));
    document.getElementById('pratikraman-morning').addEventListener('click', () => this.togglePratikraman('morning'));
    document.getElementById('pratikraman-evening').addEventListener('click', () => this.togglePratikraman('evening'));
    document.getElementById('btn-niyam').addEventListener('click', () => this.confirmNiyam());
    document.getElementById('btn-niyam-undo').addEventListener('click', () => this.undoNiyam());

    // Navigation
    document.querySelectorAll('#bottom-nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

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
  }

  // ===== LOCAL STORAGE =====
  loadSettings() {
    const saved = localStorage.getItem('km_settings');
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
  }

  loadProfile() {
    const saved = localStorage.getItem('km_profile');
    return saved ? { ...DEFAULT_PROFILE, ...JSON.parse(saved) } : { ...DEFAULT_PROFILE };
  }

  loadDailyLog() {
    const todayKey = this.getTodayKey();
    const saved = localStorage.getItem(`km_daily_${todayKey}`);
    if (saved) return { ...DEFAULT_DAILY_LOG, ...JSON.parse(saved) };
    return { ...DEFAULT_DAILY_LOG, date: todayKey };
  }

  saveSettings() { localStorage.setItem('km_settings', JSON.stringify(this.settings)); }
  saveProfile() { localStorage.setItem('km_profile', JSON.stringify(this.profile)); }
  saveDailyLog() {
    this.dailyLog.date = this.getTodayKey();
    localStorage.setItem(`km_daily_${this.getTodayKey()}`, JSON.stringify(this.dailyLog));
  }
  saveAll() { this.saveSettings(); this.saveProfile(); this.saveDailyLog(); }

  getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ===== LOCK SYSTEM =====
  isDayLocked() {
    const lockKey = `km_locked_${this.getTodayKey()}`;
    return localStorage.getItem(lockKey) === 'true';
  }

  lockDay() {
    const lockKey = `km_locked_${this.getTodayKey()}`;
    localStorage.setItem(lockKey, 'true');
    // Process end-of-day when locked
    this.processEndOfDay();
  }

  startAutoLockCheck() {
    // Check every 30 seconds if we crossed midnight
    this.autoLockInterval = setInterval(() => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        // Midnight — lock previous day
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        const lockKey = `km_locked_${yKey}`;
        if (localStorage.getItem(lockKey) !== 'true') {
          localStorage.setItem(lockKey, 'true');
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
    const lockIds = ['samayik', 'pooja', 'swadhyay', 'pratikraman', 'niyam'];

    if (locked) {
      banner.classList.remove('hidden');
      lockIds.forEach(id => {
        const card = document.getElementById(`${id}-card`);
        const lockEl = document.getElementById(`${id}-lock`);
        if (card) card.classList.add('locked');
        if (lockEl) lockEl.classList.remove('hidden');
      });
      // Disable all action buttons
      document.querySelectorAll('.btn-complete, .btn-undo, .btn-counter, .slot-btn, .btn-niyam, .pakshal-toggle input').forEach(el => {
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
      // Enable all action buttons
      document.querySelectorAll('.btn-complete, .btn-undo, .btn-counter, .slot-btn, .btn-niyam, .pakshal-toggle input').forEach(el => {
        el.disabled = false;
      });
      // Specifically disable swadhyay minus if count is 0
      const swDone = this.dailyLog.swadhyayDone || 0;
      document.getElementById('btn-swadhyay-minus').disabled = swDone <= 0;
    }
  }

  // ===== DAILY RESET =====
  checkDailyReset() {
    const todayKey = this.getTodayKey();
    if (this.dailyLog.date && this.dailyLog.date !== todayKey) {
      // Lock yesterday if not already locked
      const yLockKey = `km_locked_${this.dailyLog.date}`;
      if (localStorage.getItem(yLockKey) !== 'true') {
        localStorage.setItem(yLockKey, 'true');
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
    const lastLogin = localStorage.getItem('km_lastLogin');
    if (lastLogin !== todayKey) {
      localStorage.setItem('km_lastLogin', todayKey);
      this.addKarmaPoints(POINTS.dailyLogin, 'Daily Login Bonus!');
      this.profile.daysActive = (this.profile.daysActive || 0) + 1;
    }
  }

  // ===== PANCHANG CALCULATIONS =====
  calculatePanchang() {
    const now = new Date();
    const lat = this.settings.locationLat;
    const lng = this.settings.locationLng;
    const sunTimes = this.calculateSunriseSunset(lat, lng, now);
    const tithiInfo = this.calculateTithi(now);
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
    const refNewMoon = new Date(Date.UTC(2000, 0, 6, 18, 14, 0));
    const synodicMonth = 29.53059;
    const daysSinceRef = (date.getTime() - refNewMoon.getTime()) / (1000 * 60 * 60 * 24);
    const moonAge = ((daysSinceRef % synodicMonth) + synodicMonth) % synodicMonth;
    const tithiDuration = synodicMonth / 30;
    const tithiIndex = Math.floor(moonAge / tithiDuration);
    let paksha, tithiName;
    if (tithiIndex < 15) {
      paksha = PAKSHA.SHUKLA;
      tithiName = TITHI_NAMES[tithiIndex];
    } else {
      paksha = PAKSHA.KRISHNA;
      tithiName = TITHI_NAMES_KRISHNA[tithiIndex - 15];
    }
    const lunarMonth = Math.floor(((daysSinceRef / synodicMonth) % 12 + 12) % 12);
    return { paksha, tithiName, jainMonth: JAIN_MONTHS[lunarMonth], tithiIndex };
  }

  // ===== RENDERING =====
  renderPanchang(sunTimes, tithiInfo, now) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('panchang-date').textContent = now.toLocaleDateString('en-IN', options);
    document.getElementById('panchang-jain-month').textContent = `${tithiInfo.jainMonth} Maas`;
    document.getElementById('tithi-value').textContent = `${tithiInfo.paksha} — ${tithiInfo.tithiName}`;
    document.getElementById('sunrise-time').textContent = this.formatTime(sunTimes.sunrise);
    document.getElementById('navkarsi-time').textContent = this.formatTime(sunTimes.navkarsi);
    document.getElementById('sunset-time').textContent = this.formatTime(sunTimes.sunset);
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

    // Samayik
    const samTarget = parseInt(s.samayikTarget);
    const samDone = d.samayikDone || 0;
    document.getElementById('samayik-progress-text').textContent = `${samDone}/${samTarget}`;
    this.updateProgressRing('samayik-ring', samDone / samTarget);
    const samCard = document.getElementById('samayik-card');
    const btnSam = document.getElementById('btn-samayik');
    const btnSamUndo = document.getElementById('btn-samayik-undo');
    if (samDone >= samTarget) {
      samCard.classList.add('completed');
      btnSam.classList.add('hidden');
      if (!locked) btnSamUndo.classList.remove('hidden');
      document.getElementById('samayik-status').textContent = 'Target achieved! 🎉';
    } else {
      samCard.classList.remove('completed');
      btnSam.classList.remove('hidden');
      if (samDone > 0 && !locked) btnSamUndo.classList.remove('hidden');
      else btnSamUndo.classList.add('hidden');
      document.getElementById('samayik-status').textContent = `${samTarget - samDone} more to go`;
    }

    // Pooja
    const poojaCard = document.getElementById('pooja-card');
    const btnPooja = document.getElementById('btn-pooja');
    const btnPoojaUndo = document.getElementById('btn-pooja-undo');
    const poojaCircle = document.getElementById('pooja-circle');
    if (d.poojaDone) {
      poojaCard.classList.add('completed');
      btnPooja.classList.add('hidden');
      if (!locked) btnPoojaUndo.classList.remove('hidden');
      poojaCircle.classList.add('done');
      document.getElementById('pooja-status-text').textContent = 'Pooja completed! 🪔';
    } else {
      poojaCard.classList.remove('completed');
      btnPooja.classList.remove('hidden');
      btnPoojaUndo.classList.add('hidden');
      poojaCircle.classList.remove('done');
      document.getElementById('pooja-status-text').textContent = 'Not done yet';
    }
    document.getElementById('pakshal-checkbox').checked = d.pakshalDone || false;
    document.getElementById('pakshal-checkbox').disabled = locked;

    // Swadhyay
    const swTarget = parseInt(s.swadhyayTarget);
    const swDone = d.swadhyayDone || 0;
    document.getElementById('swadhyay-count').textContent = swDone;
    document.getElementById('swadhyay-unit').textContent = s.swadhyayUnit;
    document.getElementById('swadhyay-progress-text').textContent = `${swDone}/${swTarget} ${s.swadhyayUnit}`;
    document.getElementById('swadhyay-progress-fill').style.width = `${Math.min(100, (swDone / swTarget) * 100)}%`;
    const swCard = document.getElementById('swadhyay-card');
    if (swDone >= swTarget) swCard.classList.add('completed');
    else swCard.classList.remove('completed');
    document.getElementById('btn-swadhyay-minus').disabled = locked || swDone <= 0;
    document.getElementById('btn-swadhyay-plus').disabled = locked;

    // Pratikraman
    const pratM = d.pratikramanMorning || false;
    const pratE = d.pratikramanEvening || false;
    const pratDone = (pratM ? 1 : 0) + (pratE ? 1 : 0);
    document.getElementById('pratikraman-morning-check').textContent = pratM ? '✓' : '○';
    document.getElementById('pratikraman-evening-check').textContent = pratE ? '✓' : '○';
    document.getElementById('pratikraman-status').textContent = `${pratDone}/2 completed`;
    const morBtn = document.getElementById('pratikraman-morning');
    const eveBtn = document.getElementById('pratikraman-evening');
    morBtn.classList.toggle('completed', pratM);
    eveBtn.classList.toggle('completed', pratE);
    morBtn.disabled = locked;
    eveBtn.disabled = locked;
    const pratCard = document.getElementById('pratikraman-card');
    if (pratDone >= 2) pratCard.classList.add('completed');
    else pratCard.classList.remove('completed');

    // Niyam
    const niyamCard = document.getElementById('niyam-card');
    const btnNiyam = document.getElementById('btn-niyam');
    const btnNiyamUndo = document.getElementById('btn-niyam-undo');
    if (d.niyamFollowed) {
      niyamCard.classList.add('completed');
      btnNiyam.classList.add('hidden');
      if (!locked) btnNiyamUndo.classList.remove('hidden');
    } else {
      niyamCard.classList.remove('completed');
      btnNiyam.classList.remove('hidden');
      btnNiyamUndo.classList.add('hidden');
    }
  }

  renderDailyProgress() {
    const completed = this.getCompletedCount();
    const pct = (completed / 5) * 100;
    document.getElementById('daily-progress-text').textContent = `${completed}/5 Complete`;
    const fill = document.getElementById('daily-progress-fill');
    fill.style.width = `${pct}%`;
    fill.classList.toggle('perfect', completed >= 5);
    document.getElementById('daily-kp').textContent = `+${this.dailyLog.kpEarned || 0} KP earned today`;
  }

  renderNiyam() {
    const dayOfYear = this.getDayOfYear();
    document.getElementById('niyam-text').textContent = PACHCHAKHANS[dayOfYear % PACHCHAKHANS.length];
  }

  renderMotivation() {
    const completed = this.getCompletedCount();
    let pool;
    if (completed >= 5) pool = MOTIVATIONAL_MESSAGES.complete;
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

  completeSamayik() {
    if (this.isDayLocked()) return;
    const target = parseInt(this.settings.samayikTarget);
    if ((this.dailyLog.samayikDone || 0) >= target) return;

    this.dailyLog.samayikDone = (this.dailyLog.samayikDone || 0) + 1;
    this.profile.totalSamayik = (this.profile.totalSamayik || 0) + 1;
    this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;

    let points = POINTS.samayik;
    if (new Date().getHours() < 8) points += POINTS.samayikEarly;
    points = this.applyStreakMultiplier(points);

    this.addKarmaPoints(points, 'Samayik');
    this.showCompletionBurst(document.getElementById('samayik-card'));
    this.afterActivity();
  }

  undoSamayik() {
    if (this.isDayLocked()) return;
    if ((this.dailyLog.samayikDone || 0) <= 0) return;

    this.dailyLog.samayikDone -= 1;
    this.profile.totalSamayik = Math.max(0, (this.profile.totalSamayik || 0) - 1);

    let points = POINTS.samayik;
    points = this.applyStreakMultiplier(points);
    this.deductKarmaPoints(points);

    // Undo perfect day if it was set
    if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
      this.dailyLog.perfectDay = false;
      this.deductKarmaPoints(POINTS.perfectDay);
    }

    this.afterActivity();
  }

  completePooja() {
    if (this.isDayLocked() || this.dailyLog.poojaDone) return;

    this.dailyLog.poojaDone = true;
    this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;

    let points = POINTS.pooja;
    if (this.dailyLog.pakshalDone) points += POINTS.poojaPakshal;
    if (new Date().getHours() < 7) this.profile.earlyPooja = (this.profile.earlyPooja || 0) + 1;

    points = this.applyStreakMultiplier(points);
    this.addKarmaPoints(points, 'Pooja');
    this.showCompletionBurst(document.getElementById('pooja-card'));
    this.afterActivity();
  }

  undoPooja() {
    if (this.isDayLocked() || !this.dailyLog.poojaDone) return;

    this.dailyLog.poojaDone = false;
    let points = POINTS.pooja;
    if (this.dailyLog.pakshalDone) points += POINTS.poojaPakshal;
    points = this.applyStreakMultiplier(points);
    this.deductKarmaPoints(points);

    if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
      this.dailyLog.perfectDay = false;
      this.deductKarmaPoints(POINTS.perfectDay);
    }
    this.afterActivity();
  }

  togglePakshal() {
    if (this.isDayLocked()) return;
    this.dailyLog.pakshalDone = document.getElementById('pakshal-checkbox').checked;
    if (this.dailyLog.poojaDone && this.dailyLog.pakshalDone && !this.dailyLog.pakshalBonusGiven) {
      this.dailyLog.pakshalBonusGiven = true;
      this.addKarmaPoints(POINTS.poojaPakshal, 'Pakshal Bonus');
      this.showBonus('pooja-bonus', '🙏 Pakshal +5!');
    }
    this.saveDailyLog();
  }

  adjustSwadhyay(delta) {
    if (this.isDayLocked()) return;
    const newVal = Math.max(0, (this.dailyLog.swadhyayDone || 0) + delta);
    const oldVal = this.dailyLog.swadhyayDone || 0;
    const target = parseInt(this.settings.swadhyayTarget);
    this.dailyLog.swadhyayDone = newVal;

    if (delta > 0) {
      this.profile.totalSwadhyay = (this.profile.totalSwadhyay || 0) + 1;
      if (newVal === target) {
        this.addKarmaPoints(this.applyStreakMultiplier(POINTS.swadhyay), 'Swadhyay Target!');
        this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;
        this.showCompletionBurst(document.getElementById('swadhyay-card'));
      } else if (oldVal === target) {
        this.addKarmaPoints(POINTS.swadhyayExceed, 'Exceeded target!');
        this.showBonus('swadhyay-bonus', '📖 Exceeded +10!');
      }
    } else if (delta < 0) {
      this.profile.totalSwadhyay = Math.max(0, (this.profile.totalSwadhyay || 0) - 1);
      if (oldVal === target && newVal < target) {
        // Went below target — deduct points
        this.deductKarmaPoints(this.applyStreakMultiplier(POINTS.swadhyay));
      }
      if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
        this.dailyLog.perfectDay = false;
        this.deductKarmaPoints(POINTS.perfectDay);
      }
    }
    this.afterActivity();
  }

  togglePratikraman(slot) {
    if (this.isDayLocked()) return;

    const key = slot === 'morning' ? 'pratikramanMorning' : 'pratikramanEvening';
    const wasDone = this.dailyLog[key];
    const wasBothDone = this.dailyLog.pratikramanMorning && this.dailyLog.pratikramanEvening;

    if (!wasDone) {
      // Complete
      this.dailyLog[key] = true;
      this.profile.totalPratikraman = (this.profile.totalPratikraman || 0) + 1;
      this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;
      this.addKarmaPoints(this.applyStreakMultiplier(POINTS.pratikraman), 'Pratikraman');
      this.showCompletionBurst(document.getElementById(`pratikraman-${slot}`));

      // Both done bonus
      if (this.dailyLog.pratikramanMorning && this.dailyLog.pratikramanEvening) {
        this.addKarmaPoints(POINTS.pratikramanBoth, 'Both done!');
        this.showBonus('pratikraman-bonus', '🙏 Both +15!');
        this.profile.totalFullPratikraman = (this.profile.totalFullPratikraman || 0) + 1;
      }
    } else {
      // Undo
      this.dailyLog[key] = false;
      this.profile.totalPratikraman = Math.max(0, (this.profile.totalPratikraman || 0) - 1);
      this.deductKarmaPoints(this.applyStreakMultiplier(POINTS.pratikraman));

      // Undo both bonus if it was given
      if (wasBothDone) {
        this.deductKarmaPoints(POINTS.pratikramanBoth);
        this.profile.totalFullPratikraman = Math.max(0, (this.profile.totalFullPratikraman || 0) - 1);
      }
      if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
        this.dailyLog.perfectDay = false;
        this.deductKarmaPoints(POINTS.perfectDay);
      }
    }
    this.afterActivity();
  }

  confirmNiyam() {
    if (this.isDayLocked() || this.dailyLog.niyamFollowed) return;

    this.dailyLog.niyamFollowed = true;
    this.profile.totalNiyam = (this.profile.totalNiyam || 0) + 1;
    this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;

    let points = this.applyStreakMultiplier(POINTS.niyam);
    this.addKarmaPoints(points, 'Niyam');

    // Variable reward
    if (Math.random() < 0.4) {
      const bonus = POINTS.niyamSurprise[Math.floor(Math.random() * POINTS.niyamSurprise.length)];
      this.addKarmaPoints(bonus, 'Surprise!');
      this.showBonus('niyam-bonus', `🎁 Surprise +${bonus}!`);
    }

    this.showCompletionBurst(document.getElementById('niyam-card'));
    this.afterActivity();
  }

  undoNiyam() {
    if (this.isDayLocked() || !this.dailyLog.niyamFollowed) return;

    this.dailyLog.niyamFollowed = false;
    this.profile.totalNiyam = Math.max(0, (this.profile.totalNiyam || 0) - 1);
    this.deductKarmaPoints(this.applyStreakMultiplier(POINTS.niyam));

    if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
      this.dailyLog.perfectDay = false;
      this.deductKarmaPoints(POINTS.perfectDay);
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

    this.saveProfile();
    this.saveDailyLog();
  }

  deductKarmaPoints(points) {
    this.profile.totalKP = Math.max(0, this.profile.totalKP - points);
    this.dailyLog.kpEarned = Math.max(0, (this.dailyLog.kpEarned || 0) - points);
    this.showKPPopup(-points);
    this.saveProfile();
    this.saveDailyLog();
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
      this.profile.perfectDays = (this.profile.perfectDays || 0) + 1;
      this.profile.totalPerfectDays = (this.profile.totalPerfectDays || 0) + 1;
      this.addKarmaPoints(POINTS.perfectDay, 'Perfect Day! 🎊');
    }
  }

  isAllTasksComplete() {
    const d = this.dailyLog, s = this.settings;
    return (d.samayikDone || 0) >= parseInt(s.samayikTarget)
      && d.poojaDone
      && (d.swadhyayDone || 0) >= parseInt(s.swadhyayTarget)
      && d.pratikramanMorning && d.pratikramanEvening
      && d.niyamFollowed;
  }

  getCompletedCount() {
    const d = this.dailyLog, s = this.settings;
    let c = 0;
    if ((d.samayikDone || 0) >= parseInt(s.samayikTarget)) c++;
    if (d.poojaDone) c++;
    if ((d.swadhyayDone || 0) >= parseInt(s.swadhyayTarget)) c++;
    if (d.pratikramanMorning && d.pratikramanEvening) c++;
    if (d.niyamFollowed) c++;
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

  // ===== NAVIGATION =====
  switchTab(tabName) {
    document.querySelectorAll('#app .tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    document.querySelector(`#bottom-nav .nav-item[data-tab="${tabName}"]`).classList.add('active');
    if (tabName === 'achievements') this.renderAchievements();
  }

  switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#admin-bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`admin-tab-${tabName.replace('admin-', '')}`).classList.add('active');
    document.querySelector(`#admin-bottom-nav .nav-item[data-tab="${tabName}"]`).classList.add('active');
    if (tabName === 'admin-progress') this.renderAdminProgress();
    if (tabName === 'admin-lock') this.renderAdminLock();
  }

  // ===== ADMIN FUNCTIONS =====
  loadAdminSettingsUI() {
    const s = this.settings;
    document.getElementById('admin-samayik-target').value = s.samayikTarget;
    document.getElementById('admin-samayik-frequency').value = s.samayikFrequency;
    document.getElementById('admin-swadhyay-target').value = s.swadhyayTarget;
    document.getElementById('admin-swadhyay-unit').value = s.swadhyayUnit;
    document.getElementById('admin-pratikraman-target').value = s.pratikramanTarget;
    const locSelect = document.getElementById('admin-location');
    for (const [key, city] of Object.entries(CITIES)) {
      if (city.lat === s.locationLat && city.lng === s.locationLng) {
        locSelect.value = key;
        break;
      }
    }
  }

  saveAdminSettings() {
    this.settings.samayikTarget = parseInt(document.getElementById('admin-samayik-target').value);
    this.settings.samayikFrequency = document.getElementById('admin-samayik-frequency').value;
    this.settings.swadhyayTarget = parseInt(document.getElementById('admin-swadhyay-target').value);
    this.settings.swadhyayUnit = document.getElementById('admin-swadhyay-unit').value;
    this.settings.pratikramanTarget = document.getElementById('admin-pratikraman-target').value;

    const cityKey = document.getElementById('admin-location').value;
    const city = CITIES[cityKey];
    if (city) {
      this.settings.locationLat = city.lat;
      this.settings.locationLng = city.lng;
      this.settings.locationName = city.name;
    }

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

    // Today's activities
    const samTarget = parseInt(s.samayikTarget);
    document.getElementById('admin-samayik-status').textContent = `${d.samayikDone || 0}/${samTarget}`;
    document.getElementById('admin-samayik-status').className = `admin-act-status ${(d.samayikDone || 0) >= samTarget ? 'done' : ''}`;

    document.getElementById('admin-pooja-status').textContent = d.poojaDone ? '✓' : '✗';
    document.getElementById('admin-pooja-status').className = `admin-act-status ${d.poojaDone ? 'done' : ''}`;

    const swTarget = parseInt(s.swadhyayTarget);
    document.getElementById('admin-swadhyay-status').textContent = `${d.swadhyayDone || 0}/${swTarget}`;
    document.getElementById('admin-swadhyay-status').className = `admin-act-status ${(d.swadhyayDone || 0) >= swTarget ? 'done' : ''}`;

    const pratDone = (d.pratikramanMorning ? 1 : 0) + (d.pratikramanEvening ? 1 : 0);
    document.getElementById('admin-pratikraman-status').textContent = `${pratDone}/2`;
    document.getElementById('admin-pratikraman-status').className = `admin-act-status ${pratDone >= 2 ? 'done' : ''}`;

    document.getElementById('admin-niyam-status').textContent = d.niyamFollowed ? '✓' : '✗';
    document.getElementById('admin-niyam-status').className = `admin-act-status ${d.niyamFollowed ? 'done' : ''}`;

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
    preview.innerHTML = `
      <div class="lock-preview-item"><span>🧘 Samayik:</span> <strong>${d.samayikDone || 0}/${s.samayikTarget}</strong></div>
      <div class="lock-preview-item"><span>🪔 Pooja:</span> <strong>${d.poojaDone ? 'Done' : 'Not done'}</strong></div>
      <div class="lock-preview-item"><span>📖 Swadhyay:</span> <strong>${d.swadhyayDone || 0}/${s.swadhyayTarget} ${s.swadhyayUnit}</strong></div>
      <div class="lock-preview-item"><span>🙏 Pratikraman:</span> <strong>${(d.pratikramanMorning ? 1 : 0) + (d.pratikramanEvening ? 1 : 0)}/2</strong></div>
      <div class="lock-preview-item"><span>✨ Niyam:</span> <strong>${d.niyamFollowed ? 'Followed' : 'Not followed'}</strong></div>`;
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
    Auth.logout();
    this.currentRole = null;
    if (this.autoLockInterval) clearInterval(this.autoLockInterval);

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
    if (confirm('⚠️ Reset ALL user progress? This erases KP, badges, streaks — everything!')) {
      if (confirm('🙏 Last chance — really reset?')) {
        // Keep settings and auth, clear user data
        const settings = localStorage.getItem('km_settings');
        localStorage.clear();
        if (settings) localStorage.setItem('km_settings', settings);
        location.reload();
      }
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
