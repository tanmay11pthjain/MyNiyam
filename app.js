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

// ===== RAW NIYAM POINTS — single source of truth =====
// What a day's raw points are, derived purely from what was actually done
// that day (POINTS.* × the relevant flag/counter). No streak multiplier, no
// Perfect Day bonus, no daily-login bonus — none of those are part of the
// score anymore. The live award path (activity handlers), the historical
// recompute (_migrateToRawPoints), and the admin Excel export all read from
// this same list, so they can never disagree on what "raw points" means.
const RAW_POINT_RULES = [
  { label: 'Navkarsi', points: log => log.navkarsiDone ? POINTS.navkarsi : 0 },
  { label: 'Wake < 7AM', points: log => log.wakeUpDone ? POINTS.wakeUpEarly : 0 },
  { label: 'Sleep < 12AM', points: log => log.sleepDone ? POINTS.sleepEarly : 0 },
  { label: 'Pranam', points: log => log.pranamDone ? POINTS.pranam : 0 },
  { label: 'Pooja', points: log => log.poojaDone ? POINTS.pooja : 0 },
  { label: 'Samayik', points: log => (log.samayikDone || 0) * POINTS.samayik },
  { label: 'Devasiya', points: log => log.devasiyaDone ? POINTS.devasiya : 0 },
  { label: 'Raysiya', points: log => log.raysiyaDone ? POINTS.raysiya : 0 },
  { label: 'Book Reading', points: log => Math.floor((log.bookReadingMins || 0) / 30) * POINTS.bookReading },
  { label: 'Ratri Bhojan Tyag', points: log => log.ratriBhojanDone ? POINTS.ratriBhojan : 0 },
  { label: 'Kandmool Tyag', points: log => log.kandmoolDone ? POINTS.kandmool : 0 },
  { label: 'Daily Niyam', points: log => log.dailyNiyamDone ? POINTS.dailyNiyam : 0 },
  { label: 'Ashta Prakari', points: log => log.ashtaPrakariDone ? POINTS.ashtaPrakari : 0 },
  { label: 'Screen Time Penalty', points: log => -(Math.floor((((log.screenTimeHours || 0) * 60) + (log.screenTimeMins || 0)) / 60) * POINTS.screenTimePenalty) },
];

// A day's total raw points — the same figure used for kpEarned everywhere.
function computeRawDayPoints(log) {
  return RAW_POINT_RULES.reduce((sum, rule) => sum + rule.points(log), 0);
}

// ===== ADMIN EXCEL EXPORT — COLUMN SPEC =====
// The export's columns ARE the raw-point rules — no separate list to keep in
// sync, and no more 'Perfect Day Bonus' column now that bonus is gone.
const EXPORT_COLUMNS = RAW_POINT_RULES;

// ===== STREAK SAVER — PAST-DAY EDIT FIELD SPEC =====
// Drives the day-edit overlay's rows. 'toggle' fields flip a boolean prop;
// 'counter' fields step a numeric prop by `step`; 'screentime' steps whole
// hours only, matching the live dashboard (screenTimeMins is never adjusted
// there either, so raw-point math stays identical between an edited day and
// a live one). Ashta Prakari's `dependsOn` mirrors the live rule that it
// only ever scores alongside Pooja (toggleAshtaPrakari()).
const DAY_EDIT_FIELDS = [
  { key: 'enableNavkarsi', prop: 'navkarsiDone', icon: '🌅', label: 'Navkarsi', type: 'toggle' },
  { key: 'enableWakeup', prop: 'wakeUpDone', icon: '⏰', label: 'Wake < 7AM', type: 'toggle' },
  { key: 'enableSleep', prop: 'sleepDone', icon: '🌙', label: 'Sleep < 12AM', type: 'toggle' },
  { key: 'enablePranam', prop: 'pranamDone', icon: '🙇', label: 'Pranam', type: 'toggle' },
  { key: 'enablePooja', prop: 'poojaDone', icon: '🪔', label: 'Pooja', type: 'toggle' },
  { key: 'enablePooja', prop: 'ashtaPrakariDone', icon: '🍽️', label: 'Ashta Prakari', type: 'toggle', dependsOn: 'poojaDone' },
  { key: 'enableSamayik', prop: 'samayikDone', icon: '🧘', label: 'Samayik', type: 'counter', step: 1 },
  { key: 'enablePratikraman', prop: 'devasiyaDone', icon: '🌅', label: 'Devasiya', type: 'toggle' },
  { key: 'enablePratikraman', prop: 'raysiyaDone', icon: '🌙', label: 'Raysiya', type: 'toggle' },
  { key: 'enableBookReading', prop: 'bookReadingMins', icon: '📖', label: 'Book Reading', type: 'counter', step: 30, unit: 'min' },
  { key: 'enableRatriBhojan', prop: 'ratriBhojanDone', icon: '🍽️', label: 'Ratri Bhojan Tyag', type: 'toggle' },
  { key: 'enableKandmool', prop: 'kandmoolDone', icon: '🌱', label: 'Kandmool Tyag', type: 'toggle' },
  { key: 'enableDailyNiyam', prop: 'dailyNiyamDone', icon: '✨', label: 'Daily Niyam', type: 'toggle' },
  { key: 'enableScreenTime', prop: 'screenTimeHours', icon: '📱', label: 'Screen Time', type: 'screentime' },
];

// ===== MONTHLY NIYAM STATS — pure per-niyam spec =====
// Single source of truth for the "days/times followed" overlay (admin +
// user). Every niyam gets `countsDay(log, settings)` — did it count as
// followed that day; a counter/duration niyam also gets `amount(log)` (the
// raw quantity to sum) and `formatAmount(total)` (how to display that sum).
// Screen Time is deliberately excluded — it's a penalty, not something
// "followed", matching how getTotalTasksCount() already treats it.
const NIYAM_STATS = [
  { flag: 'enableNavkarsi', icon: '🌅', label: 'Navkarsi', countsDay: log => !!log.navkarsiDone },
  { flag: 'enableWakeup', icon: '⏰', label: 'Wake < 7AM', countsDay: log => !!log.wakeUpDone },
  { flag: 'enableSleep', icon: '🌙', label: 'Sleep < 12AM', countsDay: log => !!log.sleepDone },
  { flag: 'enablePranam', icon: '🙇', label: 'Pranam', countsDay: log => !!log.pranamDone },
  { flag: 'enablePooja', icon: '🪔', label: 'Pooja', countsDay: log => !!log.poojaDone },
  {
    flag: 'enableSamayik', icon: '🧘', label: 'Samayik',
    countsDay: (log, s) => (log.samayikDone || 0) >= parseInt((s && s.samayikTarget) || 1, 10),
    amount: log => log.samayikDone || 0,
    formatAmount: total => `${total} time${total === 1 ? '' : 's'}`
  },
  { flag: 'enablePratikraman', icon: '🌅', label: 'Devasiya', countsDay: log => !!log.devasiyaDone },
  { flag: 'enablePratikraman', icon: '🌙', label: 'Raysiya', countsDay: log => !!log.raysiyaDone },
  {
    flag: 'enableBookReading', icon: '📖', label: 'Book Reading',
    countsDay: log => (log.bookReadingMins || 0) >= 30,
    amount: log => log.bookReadingMins || 0,
    formatAmount: totalMins => {
      const h = Math.floor(totalMins / 60), m = totalMins % 60;
      return h > 0 ? `${h}h${m > 0 ? ' ' + m + 'm' : ''}` : `${m}m`;
    }
  },
  { flag: 'enableRatriBhojan', icon: '🍽️', label: 'Ratri Bhojan Tyag', countsDay: log => !!log.ratriBhojanDone },
  { flag: 'enableKandmool', icon: '🌱', label: 'Kandmool Tyag', countsDay: log => !!log.kandmoolDone },
  { flag: 'enableDailyNiyam', icon: '✨', label: 'Daily Niyam', countsDay: log => !!log.dailyNiyamDone },
];

// ===== SUN TIMES — pure NOAA/Meeus solar calculation =====
// No DOM, no network, no class state — takes lat/lng/elevation/date/timezone
// and returns real Date objects (UTC instants). Returning Date rather than a
// bare decimal-hour float is deliberate: a float loses its timezone identity,
// which was the root cause of every downstream formatting bug in the old
// implementation (minutes rounding to 60, hours never wrapping past 24, the
// fallback path silently assuming IST while the network path assumed the
// device's zone). A single Date is unambiguous regardless of who reads it.
const SunTimes = (() => {
  const toRad = deg => deg * Math.PI / 180;
  const toDeg = rad => rad * 180 / Math.PI;

  // Y/M/D as seen in `timeZone`, so the calendar day we compute for is the
  // location's day, not whatever day the device's clock happens to be on.
  function _localDateParts(date, timeZone) {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = {};
    fmt.formatToParts(date).forEach(p => { parts[p.type] = p.value; });
    return { year: parseInt(parts.year, 10), month: parseInt(parts.month, 10), day: parseInt(parts.day, 10) };
  }

  // Julian Day anchored at UTC noon of the given calendar date. Anchoring on
  // noon (rather than whatever instant `date` happens to represent) makes the
  // result independent of what time of day this function is called — the old
  // fallback derived "day of year" from the live clock, which could shift the
  // computed sunrise/sunset by a fraction of a day near local midnight.
  function _julianDayAtNoon(year, month, day) {
    const noonUTC = Date.UTC(year, month - 1, day, 12, 0, 0);
    return noonUTC / 86400000 + 2440587.5;
  }

  // Standard NOAA solar position algorithm (per Jean Meeus, Astronomical
  // Algorithms). `elevationM` applies the horizon-dip correction
  // (2.076 * sqrt(metres) arcminutes) on top of the standard 34' atmospheric
  // refraction — this is what makes sunrise measurably earlier and sunset
  // later at elevated sites (hill-station sanghs like Palitana or Mt. Abu).
  // Returns { sunrise, sunset, solarNoon } as Date objects; sunrise/sunset
  // are null for genuine polar day/night rather than a clamped, bogus time.
  function sunTimesFor(lat, lng, elevationM, date, timeZone) {
    const tz = timeZone || 'UTC';
    const { year, month, day } = _localDateParts(date, tz);
    const jd = _julianDayAtNoon(year, month, day);
    const T = (jd - 2451545.0) / 36525;

    const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(toRad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T))
      + Math.sin(toRad(2 * M)) * (0.019993 - 0.000101 * T)
      + Math.sin(toRad(3 * M)) * 0.000289;
    const trueLong = L0 + C;
    const omega = 125.04 - 1934.136 * T;
    const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(toRad(omega));

    const e0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const obliqCorr = e0 + 0.00256 * Math.cos(toRad(omega));

    const declination = Math.asin(Math.sin(toRad(obliqCorr)) * Math.sin(toRad(lambda)));

    const y = Math.pow(Math.tan(toRad(obliqCorr) / 2), 2);
    const eqTime = 4 * toDeg(
      y * Math.sin(2 * toRad(L0))
      - 2 * e * Math.sin(toRad(M))
      + 4 * e * y * Math.sin(toRad(M)) * Math.cos(2 * toRad(L0))
      - 0.5 * y * y * Math.sin(4 * toRad(L0))
      - 1.25 * e * e * Math.sin(2 * toRad(M))
    );

    const elevationDipDeg = 2.076 * Math.sqrt(Math.max(0, elevationM || 0)) / 60;
    const zenith = 90.833 + elevationDipDeg;

    const latRad = toRad(lat);
    const cosHA = (Math.cos(toRad(zenith)) - Math.sin(latRad) * Math.sin(declination))
      / (Math.cos(latRad) * Math.cos(declination));

    const utcMidnightMs = Date.UTC(year, month - 1, day, 0, 0, 0);
    const solarNoonMin = 720 - 4 * lng - eqTime;
    const solarNoon = new Date(utcMidnightMs + solarNoonMin * 60000);

    if (cosHA < -1 || cosHA > 1) {
      // |cosHA| > 1 means the hour-angle equation has no real solution —
      // the sun never crosses this zenith at this latitude/date (polar
      // day or polar night). Report "no event" rather than an invented time.
      return { sunrise: null, sunset: null, solarNoon };
    }

    const haDeg = toDeg(Math.acos(cosHA));
    const sunrise = new Date(utcMidnightMs + (solarNoonMin - 4 * haDeg) * 60000);
    const sunset = new Date(utcMidnightMs + (solarNoonMin + 4 * haDeg) * 60000);
    return { sunrise, sunset, solarNoon };
  }

  return { sunTimesFor };
})();

class KalyanMitra {
  constructor() {
    this.currentRole = null;
    this.pendingBadges = [];
    this.autoLockInterval = null;
    this.currentDayLocked = false;
    this.currentDayLockValue = null;
    this.location = null; // resolved in fetchGeolocationAndPanchang(); falls back to DEFAULT_LOCATION until then
    this.init();
  }

  // ===== INITIALIZATION =====
  async init() {
    Auth.init();
    Auth.onAuthStateChanged(async (user) => {
      if (user) {
        this.uid = user.uid;
        this.currentRole = user.role;
        this._currentAuthUser = user;
        document.getElementById('login-screen').classList.add('hidden');

        if (user.role === 'admin') {
          // Admin skips registration
          if (!this._adminInitDone) {
            this._adminInitDone = true;
            db.ref(`users/${user.uid}/name`).set(user.name || user.uid);
            db.ref(`users/${user.uid}/role`).set(user.role);
            this.initAdmin();
          }
        } else {
          // Sheet is the master for registration status.
          // user.registered is: true (registered), false (not registered),
          // or undefined (cached session — wait for fresh Sheet response)
          if (user.registered === undefined) {
            // Cached session — don't decide yet, wait for fresh Sheet response
            return;
          }
          if (user.registered) {
            if (!this._userInitDone) {
              this._userInitDone = true;
              db.ref(`users/${user.uid}/role`).set(user.role);
              this.initUser();
            }
          } else {
            this.showRegistrationForm(user);
          }
        }
      } else {
        this._userInitDone = false;
        this._adminInitDone = false;
        this.showLoginScreen();
      }
    });
  }

  showLoginScreen() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('register-screen').classList.add('hidden');
    document.getElementById('app').classList.add('app-hidden');
    document.getElementById('app').classList.remove('app-visible');
    document.getElementById('admin-panel').classList.add('hidden');

    // Create particles
    this.createLoginParticles();

    // Setup Google sign-in button
    const btn = document.getElementById('btn-google-signin');
    if (btn) {
      btn.onclick = async () => {
        btn.disabled = true;
        btn.querySelector('span').textContent = 'Signing in...';
        const errorEl = document.getElementById('login-error');
        errorEl.classList.add('hidden');

        const result = await Auth.signInWithGoogle();

        if (!result.success) {
          errorEl.textContent = result.error;
          errorEl.classList.remove('hidden');
          errorEl.classList.add('show');
          const card = document.querySelector('.login-card');
          card.classList.add('shake');
          setTimeout(() => card.classList.remove('shake'), 500);
        }

        btn.disabled = false;
        btn.querySelector('span').textContent = 'Sign in with Google';
      };
    }
  }

  createLoginParticles() {
    const container = document.getElementById('login-particles');
    if (!container || container.children.length > 0) return;
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

  // ===== REGISTRATION =====
  async showRegistrationForm(user) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('register-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('app-hidden');
    document.getElementById('admin-panel').classList.add('hidden');

    // Pre-fill name from Google account
    const nameInput = document.getElementById('reg-name');
    if (nameInput && user.name) nameInput.value = user.name;

    // Photo picker — required before registration can be submitted (see the
    // check in handleRegistration()). Reset on every visit to this screen so
    // a previously aborted registration attempt doesn't leave a stale photo.
    this._registrationPhotoDataUrl = null;
    const photoInput = document.getElementById('reg-photo-input');
    const photoPreview = document.getElementById('reg-photo-preview');
    const photoPlaceholder = document.getElementById('reg-photo-placeholder');
    if (photoInput) {
      photoInput.value = '';
      if (photoPreview) photoPreview.classList.add('hidden');
      if (photoPlaceholder) photoPlaceholder.classList.remove('hidden');
      photoInput.onchange = async () => {
        const file = photoInput.files && photoInput.files[0];
        if (!file) return;
        const errorEl = document.getElementById('register-error');
        try {
          const dataUrl = await this._resizeImageToDataUrl(file);
          this._registrationPhotoDataUrl = dataUrl;
          if (photoPreview) {
            photoPreview.src = dataUrl;
            photoPreview.classList.remove('hidden');
          }
          if (photoPlaceholder) photoPlaceholder.classList.add('hidden');
          if (errorEl) errorEl.classList.add('hidden');
        } catch (e) {
          console.error('Failed to process registration photo:', e);
          this._registrationPhotoDataUrl = null;
          if (photoPreview) photoPreview.classList.add('hidden');
          if (photoPlaceholder) photoPlaceholder.classList.remove('hidden');
          if (errorEl) {
            errorEl.textContent = (e && e.message) || 'Could not process that photo. Please try a different image.';
            errorEl.classList.remove('hidden');
          }
        }
      };
    }

    // Wire button click directly (bypass form submit)
    const btn = document.getElementById('btn-register');
    btn.onclick = () => {
      this.handleRegistration();
    };

    // Fetch sanghs list (non-blocking for button)
    this._sanghsList = [];
    this._selectedSangh = null;
    try {
      this._sanghsList = await Auth.fetchSanghs();
    } catch (e) {
      console.warn('Failed to fetch sanghs:', e);
    }
    if (this._sanghsList.length === 0) {
      const errorEl = document.getElementById('register-error');
      if (errorEl) {
        errorEl.textContent = 'Could not load the sangh list right now. Please try again in a moment, or contact your admin if this keeps happening.';
        errorEl.classList.remove('hidden');
      }
      // Not a connectivity issue if you're seeing this with a healthy network —
      // check the browser console for the actual Apps Script response/error
      // (a CORS error here means the deployment's "Who has access" needs to be
      // "Anyone", or the get_sanghs action isn't wired into doPost/doGet yet).
      console.error('Sangh list came back empty — see the Apps Script response/error logged above for the real cause.');
    }
    this._setupSanghAutocomplete();
  }

  _setupSanghAutocomplete() {
    const input = document.getElementById('reg-sangh');
    const dropdown = document.getElementById('sangh-dropdown');
    const selectedDiv = document.getElementById('sangh-selected');
    const hiddenInput = document.getElementById('reg-sangh-code');
    const sanghs = this._sanghsList || [];

    const showDropdown = (items) => {
      if (items.length === 0) {
        // No data-code attribute here, so dropdown.onclick's lookup below finds no
        // match and this row is inert — non-clickable without any extra wiring.
        dropdown.innerHTML = '<div class="sangh-option sangh-option-empty">No matching sangh</div>';
        dropdown.classList.remove('hidden');
        return;
      }
      dropdown.innerHTML = items.map(s =>
        `<div class="sangh-option" data-code="${s.code}">
          <span class="sangh-option-code">${s.code}</span>
          <span class="sangh-option-name">${s.name}</span>
          <span class="sangh-option-city">${s.city}</span>
        </div>`
      ).join('');
      dropdown.classList.remove('hidden');
    };

    const selectSangh = (sangh) => {
      this._selectedSangh = sangh;
      hiddenInput.value = sangh.code;
      input.value = '';
      input.style.display = 'none';
      dropdown.classList.add('hidden');
      selectedDiv.innerHTML = `
        <span class="sangh-chip">
          <strong>${sangh.code}</strong> — ${sangh.name}, ${sangh.city}
          <button type="button" class="sangh-chip-remove" title="Remove">✕</button>
        </span>`;
      selectedDiv.classList.remove('hidden');

      selectedDiv.querySelector('.sangh-chip-remove').onclick = () => {
        this._selectedSangh = null;
        hiddenInput.value = '';
        selectedDiv.classList.add('hidden');
        selectedDiv.innerHTML = '';
        input.style.display = '';
        input.focus();
      };
    };

    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      if (q.length === 0) {
        showDropdown(sanghs.slice(0, 10));
        return;
      }
      const filtered = sanghs.filter(s =>
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q)
      );
      showDropdown(filtered.slice(0, 10));
    };

    input.onfocus = () => {
      if (!this._selectedSangh) {
        const q = input.value.trim().toLowerCase();
        const items = q.length === 0 ? sanghs.slice(0, 10) :
          sanghs.filter(s =>
            s.code.toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q) ||
            s.city.toLowerCase().includes(q)
          ).slice(0, 10);
        showDropdown(items);
      }
    };

    dropdown.onclick = (e) => {
      const option = e.target.closest('.sangh-option');
      if (!option) return;
      const code = option.dataset.code;
      const sangh = sanghs.find(s => s.code === code);
      if (sangh) selectSangh(sangh);
    };

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.sangh-group')) {
        dropdown.classList.add('hidden');
      }
    });
  }

  async handleRegistration() {
    const name = document.getElementById('reg-name').value.trim();
    const dob = document.getElementById('reg-dob').value;
    const phone = document.getElementById('reg-phone').value.trim();
    const city = document.getElementById('reg-city').value.trim();
    const area = document.getElementById('reg-area').value.trim();
    const sanghCode = document.getElementById('reg-sangh-code').value.trim();
    const errorEl = document.getElementById('register-error');
    const btn = document.getElementById('btn-register');

    if (!name || !dob || !phone || !city || !area) {
      errorEl.textContent = 'Please fill all fields.';
      errorEl.classList.remove('hidden');
      return;
    }

    if (!this._registrationPhotoDataUrl) {
      errorEl.textContent = 'Please add a profile photo.';
      errorEl.classList.remove('hidden');
      return;
    }

    if (!/^[0-9]{10}$/.test(phone)) {
      errorEl.textContent = 'Please enter a valid 10-digit phone number.';
      errorEl.classList.remove('hidden');
      return;
    }

    if (!sanghCode || !this._selectedSangh) {
      errorEl.textContent = 'Please select a Sangh from the dropdown.';
      errorEl.classList.remove('hidden');
      return;
    }

    btn.disabled = true;
    btn.querySelector('span').textContent = 'Saving...';
    errorEl.classList.add('hidden');

    const regData = {
      name, dob, phone, city, area, sanghCode,
      sanghName: this._selectedSangh.name,
      sanghCity: this._selectedSangh.city,
      photo: this._registrationPhotoDataUrl
    };
    const user = this._currentAuthUser;

    try {
      // Save to Firebase — WITHOUT the photo. The photo lives only in the
      // Sheet (see apps-script-additions.gs); keeping it out of Firebase's
      // registration node matters because that node is read on every login
      // (renderUserHeaderBrand, _syncFromSheetProfile) and must stay small.
      const { photo, ...regDataForFirebase } = regData;
      await db.ref(`users/${this.uid}`).update({
        name: name,
        role: 'user',
        registered: true,
        registration: regDataForFirebase,
        registeredAt: new Date().toISOString()
      });

      // Link user to their sangh for admin discovery
      if (sanghCode) {
        await db.ref(`sangh_users/${sanghCode}/${this.uid}`).set(true);
      }

      // Send to Google Sheets
      try {
        await Auth.sendRegistration(this.uid, user.email, regData);
      } catch (sheetErr) {
        console.warn('Sheet update failed (non-blocking):', sheetErr);
      }

      // Cache the just-uploaded photo locally so the Profile tab shows it
      // instantly, and mark the one-time photo prompt as already satisfied —
      // a freshly registered user must never see "please add a photo" again.
      try {
        localStorage.setItem(`myniyam_photo_${this.uid}`, regData.photo);
        localStorage.setItem(`myniyam_photo_prompted_${this.uid}`, '1');
      } catch (e) { /* localStorage unavailable — non-fatal */ }

      // Hide registration, proceed to user app
      document.getElementById('register-screen').classList.add('hidden');
      this.initUser();
    } catch (err) {
      errorEl.textContent = 'Failed to save. Please try again.';
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.querySelector('span').textContent = '🙏 Join Kalyan Mitra';
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

    // Sheet is the master: sync every load (piggybacked on the login response
    // already fetched — no extra network call), so an edit made in the Sheet
    // — including a changed Sangh Code — takes effect without the user
    // needing to open the Profile tab first.
    await this._syncFromSheetProfile(this._currentAuthUser.profile);

    // One-time: recompute totalKP (and every day's kpEarned) from raw niyam
    // points, dropping the old streak-multiplier/bonus inflation. Must finish
    // before the dashboard/achievements render below, or the user briefly
    // sees their old inflated total.
    await this._migrateToRawPoints();

    this.checkDailyReset();
    // Not awaited: renders from the last-known/default location immediately,
    // then refines via GPS and Open-Meteo in the background. Never blocks the
    // dashboard on a geolocation prompt or a network round-trip.
    this.fetchGeolocationAndPanchang();
    this.grantDailyLogin();
    this.renderDashboard();
    this.renderAchievements();
    this.setupUserEventListeners();
    this.startAutoLockCheck();
    this.checkStreakWarning();
    this.renderUserHeaderBrand();
    // Not awaited: a one-time check (guarded by localStorage) for
    // already-registered users with no profile photo yet.
    this._maybePromptForPhoto();
  }

  // One-time migration to raw-points-only scoring. Recomputes every day's
  // kpEarned from RAW_POINT_RULES (the same rules the live award path and the
  // Excel export use) and sums them into a fresh profile.totalKP — discarding
  // whatever inflation past streak multipliers/Perfect-Day/daily-login bonuses
  // baked into the old numbers. Guarded by profile.rawPointsMigrated so it
  // never re-runs once it succeeds; on failure the guard is deliberately left
  // unset so the next login retries rather than silently staying un-migrated.
  //
  // Idempotent by construction: every run recomputes from the same source
  // daily_logs, so running it twice (e.g. a retry after a partial failure)
  // always converges on the same total rather than compounding.
  async _migrateToRawPoints() {
    if (this.profile.rawPointsMigrated) return;
    try {
      const snap = await db.ref(`users/${this.uid}/daily_logs`).once('value');
      const logs = snap.val() || {};

      let total = 0;
      const updates = {};
      Object.entries(logs).forEach(([dateKey, log]) => {
        if (!log) return;
        const raw = computeRawDayPoints(log);
        total += raw;
        if (log.kpEarned !== raw) updates[`${dateKey}/kpEarned`] = raw;
      });

      if (Object.keys(updates).length > 0) {
        await db.ref(`users/${this.uid}/daily_logs`).update(updates);
      }

      // Keep today's in-memory log in sync so the dashboard doesn't show a
      // stale kpEarned until the realtime listener happens to refire.
      const todayKey = this.getTodayKey();
      if (logs[todayKey] && this.dailyLog && this.dailyLog.date === todayKey) {
        this.dailyLog.kpEarned = computeRawDayPoints(this.dailyLog);
      }

      this.profile.totalKP = total;
      this.profile.rawPointsMigrated = true;
      await this.saveProfile();
    } catch (e) {
      console.warn('Raw-points migration failed — will retry on next load.', e);
    }
  }

  // Resolves each sangh code to "Name (CODE)", using knownNames where available
  // and falling back to Auth.fetchSanghs() (memoized) only for the codes it can't
  // already resolve.
  async _resolveSanghLabels(codes, knownNames = {}) {
    if (!codes || codes.length === 0) return [];

    const needsLookup = codes.some(code => !knownNames[code]);
    let sanghsList = [];
    if (needsLookup) {
      try {
        sanghsList = await Auth.fetchSanghs();
      } catch (e) {
        console.warn('Failed to fetch sanghs list:', e);
      }
    }

    return codes.map(code => {
      const name = knownNames[code] || (sanghsList.find(s => s.code === code) || {}).name;
      return name ? `${name} (${code})` : code;
    });
  }

  async renderUserHeaderBrand() {
    const el = document.getElementById('brand-sangh');
    if (!el) return;
    try {
      const snap = await db.ref(`users/${this.uid}/registration`).once('value');
      const reg = snap.val() || {};
      const code = reg.sanghCode || (this._currentAuthUser.sanghCodes || [])[0];
      if (!code) { el.textContent = ''; return; }
      const knownNames = reg.sanghName ? { [code]: reg.sanghName } : {};
      const [label] = await this._resolveSanghLabels([code], knownNames);
      el.textContent = label || '';
    } catch (e) {
      console.warn('Failed to load sangh info for header:', e);
    }
  }

  async renderAdminHeaderBrand() {
    const el = document.getElementById('admin-brand-sangh');
    if (!el) return;
    try {
      const codes = this._adminSanghCodes || [];
      if (codes.length === 0) { el.textContent = 'No sangh assigned'; return; }
      const labels = await this._resolveSanghLabels(codes);
      el.textContent = labels.join(', ');
    } catch (e) {
      console.warn('Failed to load sangh info for admin header:', e);
    }
  }

  // Applies a Sheet-sourced profile to Firebase and detects a sangh transfer
  // by comparing against the value already stored — that comparison MUST
  // happen before _mirrorProfileToFirebase() overwrites it, which is why the
  // read comes first. Keeps the sangh_users/{code}/{uid} index correct on
  // transfer and shows a one-time notice. Shared by initUser() (runs on every
  // app load) and refreshProfileFromSheet() (the Profile tab), so the two
  // entry points can't disagree on how a Sheet edit is applied.
  async _syncFromSheetProfile(profile) {
    if (!profile) return;
    try {
      const snap = await db.ref(`users/${this.uid}/registration`).once('value');
      const oldSanghCode = (snap.val() || {}).sanghCode || '';

      await this._mirrorProfileToFirebase(profile);

      // Only fires when the OLD code was non-empty — this is what stops a
      // brand-new registration (old code "") from triggering a false
      // "you've been transferred" notice on first load.
      const newSanghCode = profile.sanghCode || '';
      if (oldSanghCode && newSanghCode && oldSanghCode !== newSanghCode) {
        // sanghName/sanghCity are Firebase-only convenience fields captured
        // once at registration from the sangh dropdown — the Sheet has no
        // equivalent columns, so _mirrorProfileToFirebase() only ever updates
        // sanghCode. Left alone, renderUserHeaderBrand()/_paintSanghChip()
        // would pair the NEW code with the OLD sangh's stale name. Clearing
        // them forces both to re-resolve the new code via Auth.fetchSanghs().
        await db.ref(`users/${this.uid}/registration`).update({ sanghName: null, sanghCity: null });
        await db.ref(`sangh_users/${oldSanghCode}/${this.uid}`).remove();
        await db.ref(`sangh_users/${newSanghCode}/${this.uid}`).set(true);
        await this._showSanghTransferNotice(newSanghCode);
      }

      this.renderUserHeaderBrand();
    } catch (e) {
      console.warn('Failed to sync profile from Sheet:', e);
    }
  }

  async _showSanghTransferNotice(newSanghCode) {
    const textEl = document.getElementById('sangh-transfer-text');
    const overlay = document.getElementById('sangh-transfer-overlay');
    if (!textEl || !overlay) return;
    let label = newSanghCode;
    try {
      const [resolved] = await this._resolveSanghLabels([newSanghCode]);
      if (resolved) label = resolved;
    } catch (e) {
      console.warn('Failed to resolve new sangh name for transfer notice:', e);
    }
    textEl.textContent = `You have been transferred to ${label}.`;
    overlay.classList.remove('hidden');
    overlay.classList.add('show');
  }

  closeSanghTransferNotice() {
    const overlay = document.getElementById('sangh-transfer-overlay');
    if (overlay) { overlay.classList.remove('show'); overlay.classList.add('hidden'); }
  }

  async fetchGeolocationAndPanchang() {
    // Load this user's OWN saved location — a per-user node, never the global
    // settings singleton. Writing GPS coordinates to db.ref('settings') used
    // to broadcast one user's precise location to every connected client and
    // re-trigger everyone's panchang calculation on every save.
    try {
      const snap = await db.ref(`users/${this.uid}/location`).once('value');
      this.location = snap.val() ? { ...DEFAULT_LOCATION, ...snap.val() } : { ...DEFAULT_LOCATION };
    } catch (e) {
      console.warn('Failed to load saved location, using default:', e);
      this.location = { ...DEFAULT_LOCATION };
    }

    // Render immediately from whatever location we have — never wait on a
    // GPS prompt or the network to show a panchang card.
    this.calculatePanchang();

    if (!navigator.geolocation) return;
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 8000,
          // Sun times don't need a metre-accurate fix — accepting a fix up to
          // 30 minutes old avoids a fresh GPS acquisition on every app open.
          maximumAge: 30 * 60 * 1000
        });
      });
      this.location.lat = position.coords.latitude;
      this.location.lng = position.coords.longitude;
      this.location.source = 'gps';
      this.location.updatedAt = new Date().toISOString();
      db.ref(`users/${this.uid}/location`).update({
        lat: this.location.lat,
        lng: this.location.lng,
        source: 'gps',
        updatedAt: this.location.updatedAt
      });
      this.calculatePanchang(); // re-render with the refined coordinates
    } catch (e) {
      console.warn('Geolocation denied or timed out — using last known location.', e);
    }
  }

  // ===== ADMIN INITIALIZATION =====
  async initAdmin() {
    this.initializing = false;
    this.settings = { ...DEFAULT_SETTINGS };

    // Store admin's sangh codes from auth
    this._adminSanghCodes = this._currentAuthUser.sanghCodes || [];
    this._adminUserUids = []; // UIDs this admin manages
    this.renderAdminHeaderBrand();

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

    // Fetch user UIDs from all assigned sanghs
    await this._fetchAdminUserUids();

    // Fetch and render Leaderboard
    await this.renderAdminLeaderboard();
  }

  async _fetchAdminUserUids() {
    const codes = this._adminSanghCodes || [];
    if (codes.length === 0) {
      this._adminUserUids = [];
      console.log('Admin has no sangh codes — no users to manage.');
      return;
    }

    // Sheet is the master — fetch users by sangh code from Google Sheets
    try {
      const sheetUsers = await Auth.fetchSanghUsers(codes);
      this._adminUserUids = sheetUsers.map(u => u.uid).filter(uid => uid);
      console.log('Admin sangh codes:', codes, '| Sheet users:', this._adminUserUids);
    } catch (e) {
      console.error('Failed to fetch sangh users from Sheet:', e);
      this._adminUserUids = [];
    }
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
      devasiya: { icon: '🌅', name: 'Devasiya', count: 0 },
      raysiya: { icon: '🌙', name: 'Raysiya', count: 0 },
      book: { icon: '📖', name: 'Book Reading', count: 0 },
      ratribhojan: { icon: '🍽️', name: 'Ratri Bhojan Tyag', count: 0 },
      kandmool: { icon: '🌱', name: 'Kandmool Tyag', count: 0 },
      niyam: { icon: '✨', name: 'Daily Niyam', count: 0 },
    };

    Object.entries(allUsers).forEach(([uid, data]) => {
      if (data.role === 'admin') return;
      // Strictly ONLY include users in this admin's sangh
      if (!this._adminUserUids.includes(uid)) return;
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
        if (dayLog.devasiyaDone) acts.devasiya.count++;
        if (dayLog.raysiyaDone) acts.raysiya.count++;
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
      // Strictly ONLY include users in this admin's sangh
      if (!this._adminUserUids.includes(uid)) return;
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
          <span class="lb-stats">${u.kp} AP • 🔥 ${u.streak}</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <div class="lb-action">👁️ View</div>
          <button class="btn-delete-card-user" data-uid="${u.uid}" data-name="${u.name}" title="Delete User" style="background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; border-radius: 8px; padding: 4px 8px; font-weight: 700; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center;">🗑️</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.leaderboard-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.btn-delete-card-user');
        if (delBtn) {
          e.stopPropagation();
          const uid = delBtn.dataset.uid;
          const name = delBtn.dataset.name;
          this.deleteAdminUser(uid, name);
          return;
        }
        this.selectAdminUser(card.dataset.uid);
      });
    });
  }

  async deleteAdminUser(targetUid, targetName) {
    const uidToDelete = targetUid || this.uid;
    if (!uidToDelete) return;

    let userName = targetName;
    if (!userName) {
      if (uidToDelete === this.uid) {
        const nameEl = document.getElementById('admin-viewing-name');
        userName = nameEl ? nameEl.textContent.replace('Viewing:', '').trim() : uidToDelete;
      } else {
        const snap = await db.ref(`users/${uidToDelete}/name`).once('value');
        userName = snap.val() || uidToDelete;
      }
    }

    if (!confirm(`Are you sure you want to delete user "${userName}"?\n\nThis will permanently delete their account profile, logs, and association with your Sangh.`)) {
      return;
    }

    try {
      // 1. Remove user from all sangh_users mapping nodes across DB
      const sanghsSnap = await db.ref('sangh_users').once('value');
      const sanghsData = sanghsSnap.val() || {};
      for (const [code, sanghUserMap] of Object.entries(sanghsData)) {
        if (sanghUserMap && sanghUserMap[uidToDelete]) {
          await db.ref(`sangh_users/${code}/${uidToDelete}`).remove();
        }
      }

      // 2. Remove user main node completely (clears sanghCode, profile, logs)
      await db.ref(`users/${uidToDelete}`).remove();

      // 3. Remove lock status node
      await db.ref(`lock_status/${uidToDelete}`).remove();

      // 4. If currently viewing this user, return to leaderboard
      if (this.uid === uidToDelete) {
        this._detachAllListeners();
        this.uid = null;
        document.getElementById('admin-individual').classList.add('hidden');
        document.getElementById('admin-overview').classList.remove('hidden');
        this.switchAdminTab('admin-leaderboard');
      }

      // 5. Refresh admin state and re-render
      await this._fetchAdminUserUids();
      await this.renderAdminLeaderboard();

      alert(`User "${userName}" was successfully deleted.`);
    } catch (err) {
      console.error('Error deleting user:', err);
      alert('Failed to delete user. Please try again.');
    }
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

  // ===== EXCEL EXPORT (ADMIN LEADERBOARD) =====

  // Pure data step — no DOM, no network. Mirrors the exact same authorization
  // filter as _renderLeaderboardFromSnap() (admin role excluded, only uids in
  // this._adminUserUids kept) so the export can never leak users outside the
  // admin's own sangh(s).
  _collectExportRows(allUsers, fromKey, toKey) {
    const rows = [];
    Object.entries(allUsers || {}).forEach(([uid, data]) => {
      if (!data || data.role === 'admin') return;
      if (!this._adminUserUids.includes(uid)) return;

      const totals = EXPORT_COLUMNS.map(() => 0);
      let actualKP = 0;
      let daysLogged = 0;
      let perfectDays = 0;

      const logs = data.daily_logs || {};
      Object.entries(logs).forEach(([dateKey, log]) => {
        // Zero-padded YYYY-MM-DD keys sort lexicographically = chronologically.
        if (!log || dateKey < fromKey || dateKey > toKey) return;
        daysLogged++;
        if (log.perfectDay) perfectDays++;
        actualKP += log.kpEarned || 0;
        EXPORT_COLUMNS.forEach((col, i) => { totals[i] += col.points(log); });
      });

      const totalBasePoints = totals.reduce((sum, v) => sum + v, 0);
      rows.push({ name: data.name || uid, totals, totalBasePoints, actualKP, daysLogged, perfectDays });
    });

    rows.sort((a, b) => b.totalBasePoints - a.totalBasePoints);
    return rows;
  }

  openExportDialog() {
    const errorEl = document.getElementById('export-error');
    if (errorEl) errorEl.classList.add('hidden');

    const fromEl = document.getElementById('export-from');
    const toEl = document.getElementById('export-to');
    if (fromEl && !fromEl.value) {
      const now = new Date();
      fromEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    if (toEl && !toEl.value) toEl.value = this.getTodayKey();

    const o = document.getElementById('export-overlay');
    if (o) { o.classList.remove('hidden'); o.classList.add('show'); }
  }

  closeExportDialog() {
    const o = document.getElementById('export-overlay');
    if (o) { o.classList.remove('show'); o.classList.add('hidden'); }
  }

  async runExport() {
    const fromEl = document.getElementById('export-from');
    const toEl = document.getElementById('export-to');
    const errorEl = document.getElementById('export-error');
    const btn = document.getElementById('btn-run-export');
    const btnSpan = btn ? btn.querySelector('span') : null;

    const showError = (msg) => {
      if (errorEl) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); }
    };

    const fromKey = fromEl ? fromEl.value : '';
    const toKey = toEl ? toEl.value : '';

    if (!fromKey || !toKey) return showError('Please select both a From and To date.');
    if (fromKey > toKey) return showError('From date must be before To date.');
    if (typeof XLSX === 'undefined') {
      return showError('Export library failed to load. Please check your connection and reload the page.');
    }
    if (!this._adminUserUids || this._adminUserUids.length === 0) {
      return showError('No users found for your sangh.');
    }

    if (errorEl) errorEl.classList.add('hidden');
    const originalLabel = btnSpan ? btnSpan.textContent : '';
    if (btn) btn.disabled = true;
    if (btnSpan) btnSpan.textContent = 'Exporting...';

    try {
      const snap = await db.ref('users').once('value');
      const rows = this._collectExportRows(snap.val() || {}, fromKey, toKey);

      if (rows.length === 0) {
        showError('No users found for your sangh in this range.');
        return;
      }

      const noteRow = [
        "Niyam columns show raw points earned from each niyam that month. \"Total (Raw Points)\" and \"Actual AP Recorded\" should match for any user whose history has been migrated to raw scoring."
      ];
      const header = [
        'Name', ...EXPORT_COLUMNS.map(c => c.label),
        'Total (Raw Points)', 'Actual AP Recorded', 'Days Logged', 'Perfect Days'
      ];
      const aoa = [noteRow, header];
      rows.forEach(r => {
        aoa.push([r.name, ...r.totals, r.totalBasePoints, r.actualKP, r.daysLogged, r.perfectDays]);
      });

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = header.map((h, i) => ({ wch: i === 0 ? 20 : Math.max(10, h.length + 2) }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Niyam Points');
      XLSX.writeFile(wb, `MyNiyam_Export_${fromKey}_to_${toKey}.xlsx`);

      this.closeExportDialog();
    } catch (e) {
      console.error('Export failed:', e);
      showError('Export failed. Please try again.');
    } finally {
      if (btn) btn.disabled = false;
      if (btnSpan) btnSpan.textContent = originalLabel;
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
    this.currentDayLockValue = null;
    // The all-daily_logs listener that populates this (below, in
    // setupRealtimeSync) is intentionally not part of the awaited Promise.all,
    // so without this reset a niyam-stats/history read could momentarily
    // reuse the PREVIOUS user's cached logs before the new listener fires.
    this._cachedDailyLogs = null;

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

    // Pratikraman uses inline onclick="app.completePratikraman('morning'|'evening')" — no binding needed here

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
    bindCounter('book', (delta) => this.adjustCounter('bookReadingMins', delta * 30, POINTS.bookReading, 'book'));

    const bindScreenTime = (id, prop, delta) => {
      const btnMinus = document.getElementById(`btn-${id}-minus`);
      const btnPlus = document.getElementById(`btn-${id}-plus`);
      if (btnMinus) btnMinus.addEventListener('click', () => this.adjustScreenTime(prop, -delta));
      if (btnPlus) btnPlus.addEventListener('click', () => this.adjustScreenTime(prop, delta));
    };
    bindScreenTime('screen-h', 'screenTimeHours', 1);

    // Navigation
    document.querySelectorAll('#bottom-nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // History month navigation
    const hPrev = document.getElementById('btn-history-prev');
    const hNext = document.getElementById('btn-history-next');
    if (hPrev) hPrev.addEventListener('click', () => this._changeHistoryMonth(-1, false));
    if (hNext) hNext.addEventListener('click', () => this._changeHistoryMonth(1, false));

    // Monthly Niyam Stats — entry points on both History and Achievements tabs
    const btnStatsFromHistory = document.getElementById('btn-niyam-stats-history');
    if (btnStatsFromHistory) btnStatsFromHistory.addEventListener('click', () => this.openNiyamStats());
    const btnStatsFromAchievements = document.getElementById('btn-niyam-stats-achievements');
    if (btnStatsFromAchievements) btnStatsFromAchievements.addEventListener('click', () => this.openNiyamStats());
    const btnCloseNiyamStats = document.getElementById('btn-close-niyam-stats');
    if (btnCloseNiyamStats) btnCloseNiyamStats.addEventListener('click', () => this.closeNiyamStats());
    const niyamStatsPrev = document.getElementById('btn-niyam-stats-prev');
    const niyamStatsNext = document.getElementById('btn-niyam-stats-next');
    if (niyamStatsPrev) niyamStatsPrev.addEventListener('click', () => this._changeNiyamStatsMonth(-1));
    if (niyamStatsNext) niyamStatsNext.addEventListener('click', () => this._changeNiyamStatsMonth(1));

    // Logout
    document.getElementById('btn-user-logout').addEventListener('click', () => this.logout());

    // Overlays
    document.getElementById('btn-close-badge').addEventListener('click', () => this.closeBadgeUnlock());
    document.getElementById('btn-close-summary').addEventListener('click', () => this.closeEveningSummary());
    const closeDayEl = document.getElementById('btn-close-day-detail');
    if (closeDayEl) closeDayEl.addEventListener('click', () => this.closeDayDetail());

    // Streak saver — past-day edit overlay
    const closeDayEditBtn = document.getElementById('btn-close-day-edit');
    if (closeDayEditBtn) closeDayEditBtn.addEventListener('click', () => this.closeDayEdit());
    const cancelDayEditBtn = document.getElementById('btn-cancel-day-edit');
    if (cancelDayEditBtn) cancelDayEditBtn.addEventListener('click', () => this.closeDayEdit());
    const saveDayEditBtn = document.getElementById('btn-save-day-edit');
    if (saveDayEditBtn) saveDayEditBtn.addEventListener('click', () => this.saveDayEdit());

    // Submit day
    const btnSubmit = document.getElementById('btn-submit-day');
    if (btnSubmit) btnSubmit.addEventListener('click', () => this.submitDay());
    const btnConfirmSubmit = document.getElementById('btn-confirm-submit');
    if (btnConfirmSubmit) btnConfirmSubmit.addEventListener('click', () => this.confirmSubmitDay());
    const btnCancelSubmit = document.getElementById('btn-cancel-submit');
    if (btnCancelSubmit) btnCancelSubmit.addEventListener('click', () => this.closeSubmitConfirm());

    // Profile
    const btnProfileSave = document.getElementById('btn-profile-save');
    if (btnProfileSave) btnProfileSave.addEventListener('click', () => this.saveProfileEdits());

    // Profile photo change
    const photoChangeInput = document.getElementById('profile-photo-input');
    if (photoChangeInput) {
      photoChangeInput.addEventListener('change', () => {
        const file = photoChangeInput.files && photoChangeInput.files[0];
        if (file) this._handleProfilePhotoChange(file);
        photoChangeInput.value = ''; // allow re-selecting the same file later
      });
    }

    // Sangh transfer notice
    const btnCloseTransfer = document.getElementById('btn-close-sangh-transfer');
    if (btnCloseTransfer) btnCloseTransfer.addEventListener('click', () => this.closeSanghTransferNotice());

    // One-time "add a profile photo" prompt
    const btnClosePhotoPrompt = document.getElementById('btn-close-photo-prompt');
    if (btnClosePhotoPrompt) btnClosePhotoPrompt.addEventListener('click', () => this.closePhotoPromptOverlay());
    const btnGoToProfilePhoto = document.getElementById('btn-goto-profile-photo');
    if (btnGoToProfilePhoto) btnGoToProfilePhoto.addEventListener('click', () => this.goToProfileFromPhotoPrompt());
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
    const btnUnlockDay = document.getElementById('btn-unlock-day');
    if (btnUnlockDay) btnUnlockDay.addEventListener('click', () => this.adminUnlockDay());

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

    // Day detail close
    const closeDayBtn = document.getElementById('btn-close-day-detail');
    if (closeDayBtn) closeDayBtn.addEventListener('click', () => this.closeDayDetail());

    // Monthly Niyam Stats — admin entry point + the overlay's own controls.
    // Bound here too (not just in setupUserEventListeners()) because an admin
    // session never runs that function — only one of the two ever executes
    // per role, so there is no double-binding in practice.
    const btnStatsAdmin = document.getElementById('btn-niyam-stats-admin');
    if (btnStatsAdmin) btnStatsAdmin.addEventListener('click', () => this.openNiyamStats());
    const btnCloseNiyamStatsAdmin = document.getElementById('btn-close-niyam-stats');
    if (btnCloseNiyamStatsAdmin) btnCloseNiyamStatsAdmin.addEventListener('click', () => this.closeNiyamStats());
    const niyamStatsPrevAdmin = document.getElementById('btn-niyam-stats-prev');
    const niyamStatsNextAdmin = document.getElementById('btn-niyam-stats-next');
    if (niyamStatsPrevAdmin) niyamStatsPrevAdmin.addEventListener('click', () => this._changeNiyamStatsMonth(-1));
    if (niyamStatsNextAdmin) niyamStatsNextAdmin.addEventListener('click', () => this._changeNiyamStatsMonth(1));

    // Export leaderboard to Excel
    const openExportBtn = document.getElementById('btn-open-export');
    if (openExportBtn) openExportBtn.addEventListener('click', () => this.openExportDialog());
    const cancelExportBtn = document.getElementById('btn-cancel-export');
    if (cancelExportBtn) cancelExportBtn.addEventListener('click', () => this.closeExportDialog());
    const runExportBtn = document.getElementById('btn-run-export');
    if (runExportBtn) runExportBtn.addEventListener('click', () => this.runExport());
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
          // Deliberately NOT calling calculatePanchang() here — location now
          // lives per-user, not in this shared node, so nothing here should
          // affect sun times. Recomputing on every settings change used to
          // fan out an Open-Meteo/geolocation refresh to every connected
          // client whenever anyone (including an admin) saved settings.
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

    // Admin: listen to ALL daily_logs for history (real-time)
    if (this.currentRole === 'admin') {
      this.listenToRef(`${userPath}/daily_logs`, val => {
        this._cachedDailyLogs = val || {};
        if (!this.initializing) {
          this.renderAdminHistory();
          // Re-render open day detail modal if visible
          if (this._openDayDetailKey) this.showDayDetail(this._openDayDetailKey);
        }
      });
    }

    const p4 = this.listenToRef(`${userPath}/lock_status/${todayKey}`, val => {
      this.currentDayLocked = !!val;
      this.currentDayLockValue = val;
      if (!this.initializing) {
        if (this.currentRole === 'user') this.updateLockUI();
        else if (this.currentRole === 'admin') this.renderAdminLock();
      }
    });

    await Promise.all([p1, p2, p3, p4]);
  }

  saveSettings() { db.ref('settings').set(this.settings); }
  saveProfile() { db.ref(`users/${this.uid}/profile`).set(this.profile); }
  saveDailyLogFor(dateKey, log) {
    db.ref(`users/${this.uid}/daily_logs/${dateKey}`).set(log);
  }
  saveDailyLog() {
    this.saveDailyLogFor(this.getTodayKey(), this.dailyLog);
  }
  saveAll() { this.saveSettings(); this.saveProfile(); this.saveDailyLog(); }

  getTodayKey(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ===== STREAK SAVER =====
  _currentMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // Read-only — does not mutate or persist the profile. The month rollover
  // (resetting the used count for a new month) is applied lazily, only
  // inside _consumeStreakSaver(), so merely rendering this count can never
  // write to the profile.
  _streakSaversLeft() {
    const p = this.profile;
    const used = (p.streakSaverMonth === this._currentMonthKey()) ? (p.streakSaversUsed || 0) : 0;
    return Math.max(0, STREAK_SAVERS_PER_MONTH - used);
  }

  // Consumes one chance for the current month, rolling over the counter if
  // the last use was in a previous month. This is the only place that
  // persists streakSaversUsed/streakSaverMonth.
  _consumeStreakSaver() {
    const month = this._currentMonthKey();
    if (this.profile.streakSaverMonth !== month) {
      this.profile.streakSaverMonth = month;
      this.profile.streakSaversUsed = 0;
    }
    this.profile.streakSaversUsed = (this.profile.streakSaversUsed || 0) + 1;
  }

  // Editable window: yesterday back through 7 days ago. Today is
  // deliberately excluded — it's edited live via the dashboard, not this
  // overlay. Date keys are YYYY-MM-DD, so lexicographic comparison sorts
  // identically to chronological order and safely spans month boundaries.
  _isStreakSaverEligible(dateKey) {
    return dateKey >= this.getTodayKey(-7) && dateKey < this.getTodayKey();
  }

  // Walks backwards counting consecutive complete days against the given
  // logs map (which the caller may have merged a fresh edit into). Today
  // is counted separately and only if it's already complete, so an
  // in-progress "today" can never break the walk through past days. Bounded
  // at 3650 iterations (~10 years) as cheap insurance against a runaway loop.
  _recomputeStreakFromHistory(allLogs) {
    const s = this.settings;
    let streak = 0;
    if (this._isLogComplete(this.dailyLog, s)) streak++;
    for (let offset = -1; offset > -3650; offset--) {
      const dateKey = this.getTodayKey(offset);
      if (!this._isLogComplete(allLogs[dateKey], s)) break;
      streak++;
    }
    return streak;
  }

  // ===== LOCK SYSTEM =====
  isDayLocked() {
    return this.currentDayLocked;
  }

  // Builds the lock_status value. `by` is 'user' | 'admin' | 'auto'.
  _lockValue(by) {
    return { locked: true, by, at: new Date().toISOString() };
  }

  // Who/what locked the current day, or null if unlocked. 'unknown' covers legacy
  // lock_status nodes that were written as a bare boolean before this field existed.
  _lockedBy() {
    const v = this.currentDayLockValue;
    if (!v) return null;
    return (typeof v === 'object' && v.by) ? v.by : 'unknown';
  }

  async lockDay() {
    const lockKey = `users/${this.uid}/lock_status/${this.getTodayKey()}`;
    await db.ref(lockKey).set(this._lockValue('admin'));
    // Process end-of-day when locked
    this.processEndOfDay();
  }

  startAutoLockCheck() {
    // Check every 30 seconds if we crossed midnight
    this.autoLockInterval = setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        // Midnight — checkDailyReset() finalizes + locks the previous day and rolls
        // over to today; it is the single owner of back-locking.
        await this.checkDailyReset();
        this.renderDashboard();
        this.calculatePanchang(); // roll the panchang card to the new day too
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
      // Re-enable everything the lock branch disabled. renderActivities() (called
      // right after this in renderDashboard()) still has final authority over each
      // button's disabled state, but updateLockUI() can also run standalone (the
      // 30s interval, or right after an admin unlock) so it must not leave buttons
      // stuck disabled on its own.
      document.querySelectorAll('.btn-complete, .btn-complete-small, .btn-undo, .btn-undo-small, .btn-counter-small, .btn-niyam, .ashta-toggle input').forEach(el => {
        el.disabled = false;
      });
    }
  }

  // ===== DAILY RESET =====
  async checkDailyReset() {
    const todayKey = this.getTodayKey();
    if (this.dailyLog.date && this.dailyLog.date !== todayKey) {
      const staleDate = this.dailyLog.date;

      // Finalize the stale day. processEndOfDay() no-ops if it was already
      // finalized (e.g. the user submitted it), so this is safe to call
      // unconditionally rather than racing a separate lock_status read.
      this.processEndOfDay(staleDate);

      // Lock it if not already locked
      const yLockKey = `users/${this.uid}/lock_status/${staleDate}`;
      const snap = await db.ref(yLockKey).once('value');
      if (!snap.val()) {
        await db.ref(yLockKey).set(this._lockValue('auto'));
      }

      // New day
      this.dailyLog = { ...DEFAULT_DAILY_LOG, date: todayKey };
      this.saveDailyLog();
    }
  }

  // Finalizes `this.dailyLog` (defaulting to today) — updates the streak, awards the
  // perfect-day counter, and persists to `dateKey`'s own node. Idempotent per date via
  // the `finalized` flag, so it is safe to call from both the submit flow and the
  // daily-reset/midnight path without double-counting the streak.
  processEndOfDay(dateKey = this.getTodayKey()) {
    if (this.dailyLog.finalized) return;
    const allDone = this.isAllTasksComplete();
    this.updateStreak(allDone);
    this.dailyLog.finalized = true;
    if (allDone && !this.dailyLog.perfectDay) {
      this.dailyLog.perfectDay = true;
      this.profile.totalPerfectDays = (this.profile.totalPerfectDays || 0) + 1;
    }
    this.saveProfile();
    this.saveDailyLogFor(dateKey, this.dailyLog);
  }

  grantDailyLogin() {
    if (this.isDayLocked()) return;
    const todayKey = this.getTodayKey();
    const lastLogin = localStorage.getItem(`km_lastLogin_${this.uid}`);
    if (lastLogin !== todayKey) {
      localStorage.setItem(`km_lastLogin_${this.uid}`, todayKey);
      // No longer awards points — raw scoring only counts niyams actually
      // performed. daysActive still tracks genuine login activity.
      this.profile.daysActive = (this.profile.daysActive || 0) + 1;
    }
  }

  // ===== PANCHANG CALCULATIONS =====
  async calculatePanchang() {
    const now = new Date();
    const loc = this.location || DEFAULT_LOCATION;
    const tithiInfo = this.calculateTithi(now);
    const todayKey = this.getTodayKey();

    // Cache check — at most one Open-Meteo call per day per location.
    const cacheKey = `myniyam_sun_${loc.lat.toFixed(3)}_${loc.lng.toFixed(3)}_${todayKey}`;
    let cached = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) cached = JSON.parse(raw);
    } catch (e) { /* corrupt/unavailable cache — ignore and recompute */ }

    if (cached) {
      this.renderPanchang(
        { sunrise: new Date(cached.sunrise), sunset: new Date(cached.sunset) },
        tithiInfo, now, cached.timezone
      );
      return;
    }

    // Render the local calculation immediately — the card must never be
    // blank or stalled on a network round trip.
    const local = SunTimes.sunTimesFor(loc.lat, loc.lng, loc.elevation, now, loc.timezone);
    this.renderPanchang(local, tithiInfo, now, loc.timezone);

    // Refine via Open-Meteo in the background (not awaited by any caller —
    // calculatePanchang() itself is fire-and-forget from every call site).
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data = await res.json();
      if (!data || !data.daily || !data.daily.sunrise || !data.daily.sunrise[0]) {
        throw new Error('Unexpected Open-Meteo response shape');
      }

      const seaLevelSunrise = new Date(data.daily.sunrise[0]);
      const seaLevelSunset = new Date(data.daily.sunset[0]);
      const elevation = typeof data.elevation === 'number' ? data.elevation : loc.elevation;
      const timezone = data.timezone || loc.timezone;

      // Open-Meteo reports sea-level times; apply the same elevation delta our
      // own model would add, so the elevation correction still applies without
      // double-counting it on top of Open-Meteo's own atmospheric modeling.
      const seaLevelLocal = SunTimes.sunTimesFor(loc.lat, loc.lng, 0, now, timezone);
      const elevatedLocal = SunTimes.sunTimesFor(loc.lat, loc.lng, elevation, now, timezone);
      const sunriseDelta = (seaLevelLocal.sunrise && elevatedLocal.sunrise)
        ? elevatedLocal.sunrise.getTime() - seaLevelLocal.sunrise.getTime() : 0;
      const sunsetDelta = (seaLevelLocal.sunset && elevatedLocal.sunset)
        ? elevatedLocal.sunset.getTime() - seaLevelLocal.sunset.getTime() : 0;

      const sunTimes = {
        sunrise: new Date(seaLevelSunrise.getTime() + sunriseDelta),
        sunset: new Date(seaLevelSunset.getTime() + sunsetDelta)
      };

      // Persist refined elevation/timezone for next time.
      if (elevation !== loc.elevation || timezone !== loc.timezone) {
        this.location.elevation = elevation;
        this.location.timezone = timezone;
        this.location.source = 'open-meteo';
        db.ref(`users/${this.uid}/location`).update({ elevation, timezone, source: 'open-meteo' });
      }

      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          sunrise: sunTimes.sunrise.toISOString(),
          sunset: sunTimes.sunset.toISOString(),
          timezone
        }));
      } catch (e) { /* storage full/unavailable — non-fatal, just skip caching */ }

      this.renderPanchang(sunTimes, tithiInfo, now, timezone);
    } catch (e) {
      console.warn('Open-Meteo fetch failed — keeping the local calculation on screen.', e);
    }
  }

  // Formats a Date as a 12-hour clock time in `timezone` (falls back to the
  // device's own zone for an unknown/invalid IANA name, or before any zone has
  // been resolved yet). Using Intl instead of decimal-hour arithmetic
  // structurally rules out the old ":60 minutes" and "24:18 PM" bugs.
  _formatClockTime(date, timezone) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '--:--';
    const opts = { hour: 'numeric', minute: '2-digit', hour12: true };
    try {
      return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timezone }).format(date);
    } catch (e) {
      return new Intl.DateTimeFormat('en-US', opts).format(date);
    }
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
  renderPanchang(sunTimes, tithiInfo, now, timezone) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('panchang-date').textContent = now.toLocaleDateString('en-IN', options);

    const pakshaName = tithiInfo.paksha === 'Shukla Paksha' ? 'Shukla' : 'Krushna';
    const tithiNum = (tithiInfo.tithiIndex % 15) + 1;
    document.getElementById('tithi-value').textContent = `${tithiInfo.jainMonth} ${pakshaName} ${tithiNum}`;

    const sunriseEl = document.getElementById('sunrise-time');
    const navkarsiEl = document.getElementById('navkarsi-time');
    const sunsetEl = document.getElementById('sunset-time');

    if (sunTimes && sunTimes.sunrise) {
      const navkarsi = new Date(sunTimes.sunrise.getTime() + 48 * 60000);
      sunriseEl.textContent = this._formatClockTime(sunTimes.sunrise, timezone);
      navkarsiEl.textContent = this._formatClockTime(navkarsi, timezone);
    } else {
      sunriseEl.textContent = '--:--';
      navkarsiEl.textContent = '--:--';
    }

    if (sunTimes && sunTimes.sunset) {
      sunsetEl.textContent = this._formatClockTime(sunTimes.sunset, timezone);
    } else {
      sunsetEl.textContent = '--:--';
    }

    // No reverse-geocoding exists, so show the raw coordinates + elevation +
    // source rather than a fabricated place name — this is what actually lets
    // a user spot "this is the wrong location" at a glance.
    const locEl = document.getElementById('panchang-location');
    if (locEl) {
      const loc = this.location || DEFAULT_LOCATION;
      const sourceLabel = loc.source === 'default' ? 'Default' : 'GPS';
      locEl.textContent = `📍 ${loc.lat.toFixed(2)}, ${loc.lng.toFixed(2)} · ${Math.round(loc.elevation)}m · ${sourceLabel}`;
    }
  }

  renderDashboard() {
    // updateLockUI() runs first so it establishes the locked/unlocked baseline;
    // renderActivities() runs last so it has final authority over each button's
    // per-activity disabled state (counter min/max bounds, etc).
    this.updateLockUI();
    this.renderDailyProgress();
    this.renderNiyam();
    this.renderMotivation();
    this.renderHeader();
    this.renderSubmitButton();
    this.renderActivities();
  }

  renderHeader() {
    document.getElementById('karma-points').textContent = `${this.profile.totalKP} AP`;

    document.getElementById('streak-count').textContent = this.profile.currentStreak;
    const flame = document.getElementById('streak-flame');
    const s = this.profile.currentStreak;
    if (s >= 30) flame.textContent = '✨🔥✨';
    else if (s >= 14) flame.textContent = '🔥🔥🔥';
    else if (s >= 7) flame.textContent = '🔥🔥';
    else if (s >= 3) flame.textContent = '🔥';
    else flame.textContent = '🕯️';
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
    document.getElementById('pratikraman-card').style.display = s.enablePratikraman ? 'block' : 'none';
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
    // Pratikraman UI
    if (s.enablePratikraman) {
      const pCard = document.getElementById('pratikraman-card');
      const btnMorning = document.getElementById('pratikraman-morning');
      const btnEvening = document.getElementById('pratikraman-evening');
      const checkMorning = document.getElementById('pratikraman-morning-check');
      const checkEvening = document.getElementById('pratikraman-evening-check');
      const pStatus = document.getElementById('pratikraman-status');

      if (btnMorning) {
        if (d.devasiyaDone) btnMorning.classList.add('done');
        else btnMorning.classList.remove('done');
        btnMorning.disabled = locked;
      }
      if (checkMorning) checkMorning.textContent = d.devasiyaDone ? '●' : '○';

      if (btnEvening) {
        if (d.raysiyaDone) btnEvening.classList.add('done');
        else btnEvening.classList.remove('done');
        btnEvening.disabled = locked;
      }
      if (checkEvening) checkEvening.textContent = d.raysiyaDone ? '●' : '○';

      const pCount = (d.devasiyaDone ? 1 : 0) + (d.raysiyaDone ? 1 : 0);
      if (pStatus) pStatus.textContent = `${pCount}/2 completed`;
      if (pCard) {
        if (pCount > 0) pCard.classList.add('completed');
        else pCard.classList.remove('completed');
      }
    }
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
    updateCounterCard('book', Math.floor((d.bookReadingMins || 0) / 30));

    // Screen Time
    const stH = d.screenTimeHours || 0;
    const stM = d.screenTimeMins || 0;
    const stCard = document.getElementById('screentime-card');
    if (stCard) {
      document.getElementById('screen-h-count').textContent = `${stH}h`;
      if (stH > 0 || stM > 0) stCard.classList.add('completed');
      else stCard.classList.remove('completed');

      document.getElementById('btn-screen-h-minus').disabled = locked || stH <= 0;
      document.getElementById('btn-screen-h-plus').disabled = locked;
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
    if (s.enablePratikraman) total += 2;
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
    document.getElementById('daily-kp').textContent = `+${this.dailyLog.kpEarned || 0} AP earned today`;
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

    if (isDone) {
      this.addKarmaPoints(points, elId);
      this.showCompletionBurst(document.getElementById(`${elId}-card`));
      // Track lifetime stats
      this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;
      if (prop === 'dailyNiyamDone') this.profile.totalNiyam = (this.profile.totalNiyam || 0) + 1;
    } else {
      this.deductKarmaPoints(points);
      if (prop === 'dailyNiyamDone') this.profile.totalNiyam = Math.max(0, (this.profile.totalNiyam || 0) - 1);
      if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
        this.dailyLog.perfectDay = false;
      }
    }
    this.afterActivity();
  }

  completePratikraman(slot) {
    if (this.isDayLocked()) return;
    const prop = slot === 'morning' ? 'devasiyaDone' : 'raysiyaDone';
    const statKey = slot === 'morning' ? 'totalDevasiya' : 'totalRaysiya';
    const wasDone = !!this.dailyLog[prop];
    this.dailyLog[prop] = !wasDone;
    const pts = POINTS.devasiya; // both devasiya and raysiya are worth 30 AP

    if (!wasDone) {
      this.addKarmaPoints(pts, 'Pratikraman');
      this.showCompletionBurst(document.getElementById('pratikraman-card'));
      this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;
      this.profile[statKey] = (this.profile[statKey] || 0) + 1;
    } else {
      this.deductKarmaPoints(pts);
      this.profile[statKey] = Math.max(0, (this.profile[statKey] || 0) - 1);
      if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
        this.dailyLog.perfectDay = false;
      }
    }
    this.afterActivity();
  }

  completePooja() {
    if (this.isDayLocked() || this.dailyLog.poojaDone) return;
    this.dailyLog.poojaDone = true;
    let points = POINTS.pooja;
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
    let points = POINTS.pooja;
    if (this.dailyLog.ashtaPrakariDone) points += POINTS.ashtaPrakari;
    this.deductKarmaPoints(points);
    if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
      this.dailyLog.perfectDay = false;
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

    const points = pointsPerUnit;

    if (delta > 0) {
      this.addKarmaPoints(points, elId);
      this.showCompletionBurst(document.getElementById(`${elId}-card`));
      // Track lifetime stats for counters
      this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;
      if (prop === 'samayikDone') this.profile.totalSamayik = (this.profile.totalSamayik || 0) + 1;
      if (prop === 'bookReadingMins') this.profile.totalSwadhyay = (this.profile.totalSwadhyay || 0) + 1;
    } else {
      this.deductKarmaPoints(points);
      // Reverse lifetime stats
      if (prop === 'samayikDone') this.profile.totalSamayik = Math.max(0, (this.profile.totalSamayik || 0) - 1);
      if (prop === 'bookReadingMins') this.profile.totalSwadhyay = Math.max(0, (this.profile.totalSwadhyay || 0) - 1);
      if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) {
        this.dailyLog.perfectDay = false;
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

  // ===== SUBMIT / FINALIZE DAY (USER) =====
  async submitDay() {
    if (this.isDayLocked()) return;
    const todayKey = this.getTodayKey();
    if (this.dailyLog.date !== todayKey) {
      // The tab was left open across midnight — roll over to today instead of
      // submitting data that no longer belongs to today.
      await this.checkDailyReset();
      this.renderDashboard();
      return;
    }
    const total = this.getTotalTasksCount();
    const completed = this.getCompletedCount();
    this.showSubmitConfirm(completed, total);
  }

  showSubmitConfirm(completed, total) {
    const textEl = document.getElementById('submit-confirm-text');
    if (textEl) {
      if (completed >= total) {
        textEl.textContent = `You've completed all ${total} tasks today. Once submitted, today's entry is locked and cannot be edited — only your sangh admin can unlock it. Submit now?`;
      } else {
        const remaining = total - completed;
        textEl.textContent = `You've completed ${completed} of ${total} tasks — ${remaining} task${remaining === 1 ? '' : 's'} still pending. Submitting now locks today's entry as-is, and it cannot be edited — only your sangh admin can unlock it. Submit anyway?`;
      }
    }
    const o = document.getElementById('submit-confirm-overlay');
    if (o) { o.classList.remove('hidden'); o.classList.add('show'); }
  }

  closeSubmitConfirm() {
    const o = document.getElementById('submit-confirm-overlay');
    if (o) { o.classList.remove('show'); o.classList.add('hidden'); }
  }

  async confirmSubmitDay() {
    this.closeSubmitConfirm();
    // Re-check right before acting: the confirm dialog leaves an await gap during
    // which an admin lock or the midnight auto-lock could already have landed.
    if (this.isDayLocked()) return;

    // Set the lock flag synchronously (before any await) so a rapid double-tap on
    // Submit/Confirm can't slip through and finalize the day twice.
    this.currentDayLocked = true;
    const todayKey = this.getTodayKey();
    const lockValue = this._lockValue('user');
    this.currentDayLockValue = lockValue;
    this.renderDashboard();

    const btn = document.getElementById('btn-submit-day');
    await db.ref(`users/${this.uid}/lock_status/${todayKey}`).set(lockValue);
    this.processEndOfDay(todayKey);
    this.renderDashboard();
    this.playSubmitCelebration(btn);
    setTimeout(() => this.showEveningSummary(), 400);
  }

  showEveningSummary() {
    const total = this.getTotalTasksCount();
    const completed = this.getCompletedCount();
    const statsEl = document.getElementById('summary-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="summary-row"><span>✅ Tasks Completed</span><span>${completed}/${total}</span></div>
        <div class="summary-row"><span>🔥 Current Streak</span><span>${this.profile.currentStreak} day${this.profile.currentStreak === 1 ? '' : 's'}</span></div>
        <div class="summary-row"><span>${this.dailyLog.perfectDay ? '🎊' : '📆'} Perfect Day</span><span>${this.dailyLog.perfectDay ? 'Yes!' : 'Not today'}</span></div>`;
    }
    const kpEl = document.getElementById('summary-kp');
    if (kpEl) kpEl.textContent = `+${this.dailyLog.kpEarned || 0} AP earned today`;
    const streakEl = document.getElementById('summary-streak');
    if (streakEl) streakEl.textContent = this.profile.currentStreak > 0 ? `🔥 ${this.profile.currentStreak}-day streak!` : '';
    const pool = (total > 0 && completed >= total) ? MOTIVATIONAL_MESSAGES.complete : MOTIVATIONAL_MESSAGES.progress;
    const msgEl = document.getElementById('summary-message');
    if (msgEl) msgEl.textContent = pool[Math.floor(Math.random() * pool.length)];
    const noteEl = document.getElementById('summary-note');
    if (noteEl) noteEl.textContent = '🔓 Want to unlock? Contact your sangh admin.';

    const o = document.getElementById('evening-summary-overlay');
    if (!o) return;
    o.classList.remove('hidden'); o.classList.add('show');
    if (this.dailyLog.perfectDay) this.createConfetti(o);
  }

  renderSubmitButton() {
    const btn = document.getElementById('btn-submit-day');
    const note = document.getElementById('submit-day-note');
    if (!btn) return;
    const locked = this.isDayLocked();
    btn.classList.toggle('submitted', locked);
    btn.disabled = locked;
    btn.textContent = locked ? '✅ Entry Submitted' : "✅ Submit Today's Entry";
    if (!note) return;
    if (!locked) {
      note.textContent = "Once submitted, today's entry is locked and cannot be edited.";
    } else {
      const reasons = {
        admin: 'Locked by your sangh admin.',
        auto: 'Auto-finalized at midnight.',
        user: "You submitted today's entry.",
      };
      const reason = reasons[this._lockedBy()] || "Today's entry is locked.";
      note.textContent = `${reason} 🔓 Want to unlock? Contact your sangh admin.`;
    }
  }

  // ===== GAMIFICATION ENGINE =====
  addKarmaPoints(points, reason) {
    this.profile.totalKP += points;
    this.dailyLog.kpEarned = (this.dailyLog.kpEarned || 0) + points;
    this.showKPPopup(points);
  }

  deductKarmaPoints(points) {
    this.profile.totalKP = Math.max(0, this.profile.totalKP - points);
    this.dailyLog.kpEarned = Math.max(0, (this.dailyLog.kpEarned || 0) - points);
    this.showKPPopup(-points);
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
      // No longer awards points — raw scoring only counts niyams actually
      // performed. The Perfect Day badge/star/stats still track this flag.
    }
  }

  isAllTasksComplete() {
    return this._isLogComplete(this.dailyLog, this.settings);
  }

  // Pure completeness check against any log/settings pair — not tied to
  // `this.dailyLog`, so it can be reused for past-day edits (streak saver)
  // and streak recomputation. `parseInt(s.samayikTarget || 1)` guards against
  // an NaN comparison if samayikTarget is ever missing.
  _isLogComplete(log, settings) {
    if (!log) return false;
    const d = log, s = settings;
    if (s.enableNavkarsi && !d.navkarsiDone) return false;
    if (s.enableWakeup && !d.wakeUpDone) return false;
    if (s.enableSleep && !d.sleepDone) return false;
    if (s.enablePranam && !d.pranamDone) return false;
    if (s.enablePooja && !d.poojaDone) return false;
    if (s.enableSamayik && (d.samayikDone || 0) < parseInt(s.samayikTarget || 1)) return false;
    if (s.enablePratikraman && !d.devasiyaDone) return false;
    if (s.enablePratikraman && !d.raysiyaDone) return false;
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
    if (s.enablePratikraman && d.devasiyaDone) c++;
    if (s.enablePratikraman && d.raysiyaDone) c++;
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
        case 'totalFullPratikraman': earned = ((p.totalDevasiya || 0) + (p.totalRaysiya || 0)) >= badge.threshold; break;
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
    popup.textContent = points >= 0 ? `+${points} AP` : `${points} AP`;
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
      // Randomize the drift per piece so the fall fans out instead of every
      // piece following the same default --confetti-x/--confetti-y direction.
      c.style.setProperty('--confetti-x', `${(Math.random() - 0.5) * 240}px`);
      c.style.setProperty('--confetti-y', `${120 + Math.random() * 260}px`);
      container.appendChild(c);
      setTimeout(() => c.remove(), 4000);
    }
  }

  // Reward burst played when the user submits their day: a shockwave + particle
  // burst anchored on the Submit button, composed from the same DOM/cleanup
  // pattern as showCompletionBurst()/createConfetti() above. Skips entirely under
  // prefers-reduced-motion.
  playSubmitCelebration(buttonEl) {
    if (!buttonEl) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const container = document.getElementById('burst-container');
    if (!container) return;

    const rect = buttonEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Shockwave rings
    for (let i = 0; i < 2; i++) {
      const ring = document.createElement('div');
      ring.className = 'submit-burst-ring';
      ring.style.left = `${cx}px`;
      ring.style.top = `${cy}px`;
      ring.style.animationDelay = `${i * 0.15}s`;
      container.appendChild(ring);
      setTimeout(() => ring.remove(), 1000);
    }

    // Particle burst — richer/longer than the per-activity showCompletionBurst(),
    // using its own .reward-particle class so that effect is left untouched.
    const colors = ['#FFD700', '#FF9933', '#E8722A', '#6B9E6B', '#F1C40F'];
    const count = 32;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'reward-particle';
      const angle = (i / count) * 360 + (Math.random() * 12 - 6);
      const dist = 70 + Math.random() * 90;
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.setProperty('--dx', `${Math.cos(angle * Math.PI / 180) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle * Math.PI / 180) * dist - 30}px`);
      p.style.backgroundColor = colors[i % colors.length];
      container.appendChild(p);
      setTimeout(() => p.remove(), 1100);
    }

    // Rising label
    const label = document.createElement('div');
    label.className = 'submit-rise-label';
    label.textContent = '🙏 Submitted!';
    label.style.left = `${cx}px`;
    label.style.top = `${cy}px`;
    container.appendChild(label);
    setTimeout(() => label.remove(), 1300);
  }

  // ===== ACHIEVEMENTS TAB =====
  renderAchievements() {
    document.getElementById('stat-total-kp').textContent = this.profile.totalKP;
    document.getElementById('stat-longest-streak').textContent = this.profile.longestStreak;
    document.getElementById('stat-total-samayik').textContent = this.profile.totalSamayik || 0;
    document.getElementById('stat-total-swadhyay').textContent = this.profile.totalSwadhyay || 0;
    document.getElementById('stat-total-devasiya').textContent = this.profile.totalDevasiya || 0;
    document.getElementById('stat-total-raysiya').textContent = this.profile.totalRaysiya || 0;
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
      this._cachedDailyLogs = allLogs;
      this._renderHistoryDays(listEl, allLogs, this._historyYear, this._historyMonth, true);
    } catch (e) {
      listEl.innerHTML = '<div style="text-align:center; color:red;">Failed to load history.</div>';
    }
  }

  // ===== PROFILE TAB =====
  async renderProfile() {
    // Header (name/email) — from the already-loaded auth user, no network needed.
    const user = this._currentAuthUser || {};
    const nameHeaderEl = document.getElementById('profile-header-name');
    if (nameHeaderEl) nameHeaderEl.textContent = user.name || '';
    const emailEl = document.getElementById('profile-header-email');
    if (emailEl) emailEl.textContent = user.email || '';

    // Photo: instant paint from cache/Google account, then refresh from the
    // Sheet (the master) in the background — not awaited, same pattern as
    // the rest of this tab.
    this._loadProfilePhoto();

    // Paint immediately from the Firebase copy — instant, always available, and what
    // keeps this tab usable even before the Sheet-side get_profile/update_profile
    // actions have been deployed.
    try {
      const snap = await db.ref(`users/${this.uid}/registration`).once('value');
      this._paintProfile(snap.val() || {});
    } catch (e) {
      console.warn('Failed to load registration from Firebase:', e);
    }

    // Then refresh from the Sheet (the master) so external Sheet edits show up.
    this.refreshProfileFromSheet();
  }

  // Shared image pipeline for both the registration photo picker and the
  // Profile tab's "Change photo" control. Resizes/centre-crops to a 256x256
  // JPEG and compresses under a Sheets cell's character budget (a cell caps
  // out around 50,000 chars; base64 inflates binary by ~33%). Uses
  // createImageBitmap with imageOrientation:'from-image' so a portrait phone
  // photo isn't stored sideways — <canvas> silently drops EXIF orientation
  // otherwise, which is the classic bug with this kind of pipeline.
  async _resizeImageToDataUrl(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      throw new Error('Please choose an image file.');
    }

    const SIZE = 256;
    const MAX_CHARS = 45000; // keep in sync with MAX_PHOTO_CHARS in apps-script-additions.gs

    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      throw new Error('Could not read that image. Please try a different file.');
    }

    try {
      const side = Math.min(bitmap.width, bitmap.height);
      const sx = (bitmap.width - side) / 2;
      const sy = (bitmap.height - side) / 2;

      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);

      let quality = 0.8;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > MAX_CHARS && quality > 0.35) {
        quality -= 0.15;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      if (dataUrl.length > MAX_CHARS) {
        throw new Error('This photo is too large even after compression. Please try a different image.');
      }
      return dataUrl;
    } finally {
      bitmap.close();
    }
  }

  // Instant paint from cache/Google account photo, then a background refresh
  // from the Sheet (the master) — mirrors the pattern already used for the
  // rest of the Profile tab's data.
  async _loadProfilePhoto() {
    const avatarEl = document.getElementById('profile-avatar');
    const placeholderEl = document.getElementById('profile-avatar-placeholder');
    if (!avatarEl) return;

    const cacheKey = `myniyam_photo_${this.uid}`;
    let cached = null;
    try { cached = localStorage.getItem(cacheKey); } catch (e) { /* unavailable — ignore */ }

    const applyPhoto = (src) => {
      if (src) {
        avatarEl.src = src;
        avatarEl.classList.remove('hidden');
        if (placeholderEl) placeholderEl.classList.add('hidden');
      } else {
        avatarEl.classList.add('hidden');
        if (placeholderEl) placeholderEl.classList.remove('hidden');
      }
    };

    applyPhoto(cached || (this._currentAuthUser && this._currentAuthUser.photoURL) || null);

    const photo = await Auth.fetchPhoto(this.uid); // never throws; null on any failure or "no photo"
    if (photo) {
      applyPhoto(photo);
      try { localStorage.setItem(cacheKey, photo); } catch (e) { /* storage full — non-fatal */ }
    }
  }

  // Bound to the Profile tab's "Change photo" file input.
  async _handleProfilePhotoChange(file) {
    const errorEl = document.getElementById('profile-error');
    if (errorEl) errorEl.classList.add('hidden');
    try {
      const dataUrl = await this._resizeImageToDataUrl(file);
      const result = await Auth.updatePhoto(this.uid, dataUrl);
      if (result.success) {
        const avatarEl = document.getElementById('profile-avatar');
        const placeholderEl = document.getElementById('profile-avatar-placeholder');
        if (avatarEl) {
          avatarEl.src = dataUrl;
          avatarEl.classList.remove('hidden');
        }
        if (placeholderEl) placeholderEl.classList.add('hidden');
        try {
          localStorage.setItem(`myniyam_photo_${this.uid}`, dataUrl);
          localStorage.setItem(`myniyam_photo_prompted_${this.uid}`, '1');
        } catch (e) { /* non-fatal */ }
      } else if (errorEl) {
        errorEl.textContent = 'Failed to upload photo. Please try again.';
        errorEl.classList.remove('hidden');
      }
    } catch (e) {
      console.error('Photo upload failed:', e);
      if (errorEl) {
        errorEl.textContent = (e && e.message) || 'Could not process that photo. Please try a different image.';
        errorEl.classList.remove('hidden');
      }
    }
  }

  // One-time "please add a profile photo" prompt for already-registered
  // users. Guarded by localStorage so it fires at most once per user, and
  // skipped entirely if a Sheet photo already exists (in which case it's
  // cached here too, saving _loadProfilePhoto() a redundant fetch later).
  async _maybePromptForPhoto() {
    const promptedKey = `myniyam_photo_prompted_${this.uid}`;
    try {
      if (localStorage.getItem(promptedKey)) return;
    } catch (e) { /* localStorage unavailable — proceed as if not yet prompted */ }

    const photo = await Auth.fetchPhoto(this.uid); // never throws; null on any failure or "no photo"
    try { localStorage.setItem(promptedKey, '1'); } catch (e) { /* non-fatal */ }

    if (photo) {
      try { localStorage.setItem(`myniyam_photo_${this.uid}`, photo); } catch (e) { /* non-fatal */ }
      return; // already has a photo — never show the popup
    }
    this._showPhotoPromptOverlay();
  }

  _showPhotoPromptOverlay() {
    const overlay = document.getElementById('photo-prompt-overlay');
    if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('show'); }
  }

  closePhotoPromptOverlay() {
    const overlay = document.getElementById('photo-prompt-overlay');
    if (overlay) { overlay.classList.remove('show'); overlay.classList.add('hidden'); }
  }

  goToProfileFromPhotoPrompt() {
    this.closePhotoPromptOverlay();
    this.switchTab('profile');
  }

  async refreshProfileFromSheet() {
    const statusEl = document.getElementById('profile-sync-status');
    if (statusEl) statusEl.classList.remove('hidden');
    try {
      const profile = await Auth.fetchProfile(this.uid);
      if (profile) {
        this._paintProfile(profile);
        await this._syncFromSheetProfile(profile);
      } else {
        console.warn('No profile returned from Sheet — keeping Firebase values on screen.');
      }
    } catch (e) {
      console.warn('Failed to refresh profile from Sheet:', e);
    } finally {
      if (statusEl) statusEl.classList.add('hidden');
    }
  }

  // Paints the read-only fields, sangh chip, and editable inputs from either the
  // Firebase registration object or the Sheet's get_profile response — both use the
  // same logical field names (name, dob, phone, city, area, sanghCode), so one
  // painter handles both sources. Skips an input the user is actively typing in so
  // an async Sheet refresh can't clobber an in-progress edit.
  _paintProfile(data) {
    const nameEl = document.getElementById('profile-view-name');
    if (nameEl) nameEl.textContent = data.name || this._currentAuthUser.name || '—';

    const dobEl = document.getElementById('profile-view-dob');
    if (dobEl) dobEl.textContent = data.dob ? this._formatDob(data.dob) : '—';

    const phoneEl = document.getElementById('profile-phone');
    if (phoneEl && document.activeElement !== phoneEl) phoneEl.value = data.phone || '';
    const cityEl = document.getElementById('profile-city');
    if (cityEl && document.activeElement !== cityEl) cityEl.value = data.city || '';
    const areaEl = document.getElementById('profile-area');
    if (areaEl && document.activeElement !== areaEl) areaEl.value = data.area || '';

    this._paintSanghChip(data);
  }

  _formatDob(dobStr) {
    const d = new Date(`${dobStr}T00:00:00`);
    if (isNaN(d.getTime())) return dobStr;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // Renders the sangh as a read-only chip (no remove button) — this, plus never
  // calling _setupSanghAutocomplete() here, is the entire client-side sangh lock.
  // The real enforcement is server-side, in the update_profile Apps Script action.
  async _paintSanghChip(data) {
    const el = document.getElementById('profile-view-sangh');
    if (!el) return;
    const code = data.sanghCode || (this._currentAuthUser.sanghCodes || [])[0];
    if (!code) { el.textContent = 'Not set'; return; }

    let name = data.sanghName;
    let city = data.sanghCity;
    if (!name) {
      try {
        const sanghs = await Auth.fetchSanghs();
        const match = sanghs.find(s => s.code === code);
        if (match) { name = match.name; city = match.city; }
      } catch (e) { /* fall back to code-only display below */ }
    }
    el.innerHTML = name
      ? `<span class="sangh-chip"><strong>${code}</strong> — ${name}${city ? ', ' + city : ''}</span>`
      : `<span class="sangh-chip"><strong>${code}</strong></span>`;
  }

  // Mirrors Sheet data into Firebase with update() (not set()) so untouched keys like
  // sanghName/sanghCity/dob survive. Also mirrors name to the denormalized
  // users/{uid}/name path that the admin leaderboard reads, so a name edited only in
  // the Sheet doesn't leave the admin view stale.
  async _mirrorProfileToFirebase(profile) {
    try {
      const updates = {};
      ['name', 'dob', 'phone', 'city', 'area', 'sanghCode'].forEach(k => {
        if (profile[k] !== undefined) updates[k] = profile[k];
      });
      if (Object.keys(updates).length === 0) return;
      await db.ref(`users/${this.uid}/registration`).update(updates);
      if (updates.name) {
        await db.ref(`users/${this.uid}/name`).set(updates.name);
      }
    } catch (e) {
      console.warn('Failed to mirror profile to Firebase:', e);
    }
  }

  // Bound to #btn-profile-save. Only mirrors to Firebase on a confirmed Sheet
  // success — unlike sendRegistration()'s fire-and-forget pattern, a failure here
  // must not let the two stores silently diverge.
  async saveProfileEdits() {
    const phone = document.getElementById('profile-phone').value.trim();
    const city = document.getElementById('profile-city').value.trim();
    const area = document.getElementById('profile-area').value.trim();
    const errorEl = document.getElementById('profile-error');
    const btn = document.getElementById('btn-profile-save');
    const confEl = document.getElementById('profile-save-confirmation');

    if (!phone || !city || !area) {
      errorEl.textContent = 'Please fill all fields.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!/^[0-9]{10}$/.test(phone)) {
      errorEl.textContent = 'Please enter a valid 10-digit phone number.';
      errorEl.classList.remove('hidden');
      return;
    }

    errorEl.classList.add('hidden');
    btn.disabled = true;
    const btnSpan = btn.querySelector('span');
    const originalLabel = btnSpan.textContent;
    btnSpan.textContent = 'Saving...';

    try {
      const result = await Auth.updateProfile(this.uid, { phone, city, area });
      if (result.success) {
        await this._mirrorProfileToFirebase({ phone, city, area });
        confEl.classList.remove('hidden');
        setTimeout(() => confEl.classList.add('hidden'), 2500);
      } else {
        errorEl.textContent = 'Failed to save. Please try again.';
        errorEl.classList.remove('hidden');
      }
    } catch (e) {
      console.error('Profile save failed:', e);
      errorEl.textContent = 'Failed to save. Please try again.';
      errorEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btnSpan.textContent = originalLabel;
    }
  }

  renderAdminHistory() {
    this._initAdminHistoryState();
    const listEl = document.getElementById('admin-history-list');
    const labelEl = document.getElementById('admin-history-month-label');
    if (!listEl || !labelEl) return;

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    labelEl.textContent = `${monthNames[this._adminHistoryMonth]} ${this._adminHistoryYear}`;

    const allLogs = this._cachedDailyLogs || {};
    this._renderHistoryDays(listEl, allLogs, this._adminHistoryYear, this._adminHistoryMonth, true);
  }

  _renderHistoryDays(container, allLogs, year, month, isAdmin) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = this.getTodayKey();
    const s = this.settings || DEFAULT_SETTINGS;
    // Note: `isAdmin` is passed `true` from both call sites (user + admin
    // history), so it cannot be used as a role signal. currentRole is the
    // only trustworthy check — streak saver editing is user-only.
    const canEdit = this.currentRole === 'user';
    const saversLeft = canEdit ? this._streakSaversLeft() : 0;
    let html = '';

    for (let day = daysInMonth; day >= 1; day--) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dateKey > today) continue;

      const log = allLogs[dateKey];
      const clickAttr = log ? `data-datekey="${dateKey}" style="cursor:pointer"` : '';
      const inWindow = canEdit && this._isStreakSaverEligible(dateKey);
      const editBtn = !inWindow ? '' : (saversLeft > 0
        ? `<button type="button" class="history-edit-btn" data-editkey="${dateKey}" title="Edit this day">✏️ Edit</button>`
        : `<button type="button" class="history-edit-btn" disabled title="No streak savers left this month">✏️ Edit</button>`);

      if (!log) {
        html += `<div class="history-day history-empty">
          <div class="history-date">${this._formatHistoryDate(dateKey)}</div>
          <div class="history-summary">No data recorded</div>
          ${editBtn}
        </div>`;
        continue;
      }

      let done = 0, total = 0;
      const checks = [
        { enabled: s.enableNavkarsi, val: log.navkarsiDone },
        { enabled: s.enableWakeup, val: log.wakeUpDone },
        { enabled: s.enableSleep, val: log.sleepDone },
        { enabled: s.enablePranam, val: log.pranamDone },
        { enabled: s.enablePooja, val: log.poojaDone },
        { enabled: s.enableSamayik, val: (log.samayikDone || 0) >= parseInt(s.samayikTarget || 1) },
        { enabled: s.enablePratikraman, val: !!log.devasiyaDone },
        { enabled: s.enablePratikraman, val: !!log.raysiyaDone },
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

      const icons = [];
      if (s.enableNavkarsi && log.navkarsiDone) icons.push('🌅');
      if (s.enableWakeup && log.wakeUpDone) icons.push('⏰');
      if (s.enablePooja && log.poojaDone) icons.push('🪔');
      if (s.enableSamayik && (log.samayikDone || 0) > 0) icons.push('🧘');
      if (s.enablePratikraman && log.devasiyaDone) icons.push('🌅');
      if (s.enablePratikraman && log.raysiyaDone) icons.push('🌙');
      if (s.enableBookReading && (log.bookReadingMins || 0) >= 30) icons.push('📖');
      if (s.enableRatriBhojan && log.ratriBhojanDone) icons.push('🍽️');
      if (s.enableKandmool && log.kandmoolDone) icons.push('🌱');
      if (s.enableDailyNiyam && log.dailyNiyamDone) icons.push('✨');

      html += `<div class="history-day ${statusClass}" ${clickAttr}>
        <div class="history-date">${this._formatHistoryDate(dateKey)}${isPerfect ? ' ⭐' : ''}</div>
        <div class="history-bar-wrap">
          <div class="history-bar" style="width:${pct}%"></div>
        </div>
        <div class="history-meta">
          <span class="history-pct">${done}/${total} (${pct}%)</span>
          <span class="history-kp">+${kp} AP</span>
        </div>
        <div class="history-icons">${icons.join(' ')}</div>
        ${editBtn}
      </div>`;
    }

    container.innerHTML = html || '<div style="text-align:center; padding:20px; color:#795548;">No history for this month.</div>';

    // Attach click listeners for day detail
    container.querySelectorAll('.history-day[data-datekey]').forEach(card => {
      card.addEventListener('click', () => {
        this.showDayDetail(card.dataset.datekey);
      });
    });

    if (canEdit) {
      // stopPropagation so clicking Edit on a day that also has data doesn't
      // also fire the day-detail click handler bound just above.
      container.querySelectorAll('.history-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openDayEdit(btn.dataset.editkey);
        });
      });
      const statusEl = document.getElementById('streak-saver-status');
      if (statusEl) {
        statusEl.textContent = `🛡️ Streak Savers: ${this._streakSaversLeft()} of ${STREAK_SAVERS_PER_MONTH} left this month`;
      }
    }
  }

  // ===== MONTHLY NIYAM STATS (admin + user, shared) =====

  // Pure — no DOM, no network. Walks the given month's date keys against
  // NIYAM_STATS and returns per-niyam totals plus month-level context.
  // Skips future dates with the same `dateKey > today` guard used by
  // _renderHistoryDays(), so the current month is never measured against
  // days that haven't happened yet.
  _computeNiyamStats(logs, year, month) {
    const s = this.settings || DEFAULT_SETTINGS;
    const today = this.getTodayKey();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const enabled = NIYAM_STATS.filter(n => s[n.flag]);
    const stats = enabled.map(n => ({
      icon: n.icon, label: n.label, days: 0,
      amount: n.amount ? 0 : null, formatAmount: n.formatAmount || null
    }));

    const safeLogs = logs || {};
    let daysElapsed = 0, daysRecorded = 0, perfectDays = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dateKey > today) break; // future — this and every later day this month haven't happened
      daysElapsed++;

      const log = safeLogs[dateKey];
      if (!log) continue;
      daysRecorded++;
      if (log.perfectDay) perfectDays++;

      enabled.forEach((n, i) => {
        if (n.countsDay(log, s)) stats[i].days++;
        if (n.amount) stats[i].amount += (n.amount(log) || 0);
      });
    }

    return { stats, daysElapsed, daysRecorded, perfectDays };
  }

  // Always resets to the current month on open — deliberate, so admin
  // switching between users (or the user reopening later) never shows a
  // stale month left over from a previous view.
  openNiyamStats() {
    const now = new Date();
    this._niyamStatsMonth = now.getMonth();
    this._niyamStatsYear = now.getFullYear();
    const overlay = document.getElementById('niyam-stats-overlay');
    if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('show'); }
    this.renderNiyamStats();
  }

  closeNiyamStats() {
    const overlay = document.getElementById('niyam-stats-overlay');
    if (overlay) { overlay.classList.remove('show'); overlay.classList.add('hidden'); }
  }

  _changeNiyamStatsMonth(delta) {
    this._niyamStatsMonth += delta;
    if (this._niyamStatsMonth > 11) { this._niyamStatsMonth = 0; this._niyamStatsYear++; }
    if (this._niyamStatsMonth < 0) { this._niyamStatsMonth = 11; this._niyamStatsYear--; }
    this.renderNiyamStats();
  }

  // Shared by both admin and user: on the admin side this.uid is already the
  // selected user (set in selectAdminUser()), so reading
  // users/{this.uid}/daily_logs needs no branching. Uses _cachedDailyLogs
  // when already populated (set by renderHistory()/renderAdminHistory()'s
  // listener); otherwise fetches it directly — this is the guard that keeps
  // the user-side Achievements-tab entry point working even if History was
  // never opened this session.
  async renderNiyamStats() {
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const labelEl = document.getElementById('niyam-stats-month-label');
    if (labelEl) labelEl.textContent = `${monthNames[this._niyamStatsMonth]} ${this._niyamStatsYear}`;

    const listEl = document.getElementById('niyam-stats-list');
    const summaryEl = document.getElementById('niyam-stats-summary');
    if (!listEl) return;

    let logs = this._cachedDailyLogs;
    if (logs == null) {
      listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#795548;">Loading...</div>';
      if (summaryEl) summaryEl.textContent = '';
      try {
        const snap = await db.ref(`users/${this.uid}/daily_logs`).once('value');
        logs = snap.val() || {};
        this._cachedDailyLogs = logs;
      } catch (e) {
        listEl.innerHTML = '<div style="text-align:center; color:red;">Failed to load stats.</div>';
        return;
      }
    }

    const { stats, daysElapsed, daysRecorded, perfectDays } =
      this._computeNiyamStats(logs, this._niyamStatsYear, this._niyamStatsMonth);

    if (summaryEl) {
      summaryEl.textContent = daysElapsed > 0
        ? `${daysRecorded} of ${daysElapsed} day${daysElapsed === 1 ? '' : 's'} logged · ${perfectDays} perfect day${perfectDays === 1 ? '' : 's'}`
        : 'No days have occurred yet in this month.';
    }

    if (stats.length === 0) {
      listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#795548;">No niyams are currently enabled.</div>';
      return;
    }

    listEl.innerHTML = stats.map(st => `
      <div class="niyam-stat-row">
        <span class="niyam-stat-icon">${st.icon}</span>
        <span class="niyam-stat-label">${st.label}</span>
        <span class="niyam-stat-value">${st.days} day${st.days === 1 ? '' : 's'}${st.amount !== null && st.formatAmount ? ' · ' + st.formatAmount(st.amount) : ''}</span>
      </div>
    `).join('');
  }

  showDayDetail(dateKey) {
    const logs = this._cachedDailyLogs || {};
    const log = logs[dateKey];
    if (!log) return;

    const s = this.settings || DEFAULT_SETTINGS;
    const overlay = document.getElementById('day-detail-overlay');
    const userEl = document.getElementById('day-detail-user');
    const dateEl = document.getElementById('day-detail-date');
    const summaryEl = document.getElementById('day-detail-summary');
    const gridEl = document.getElementById('day-detail-grid');
    if (!overlay || !userEl || !dateEl || !summaryEl || !gridEl) return;

    // User name from banner
    const bannerName = document.getElementById('admin-viewing-name');
    userEl.textContent = (this.currentRole === 'admin' && bannerName) ? bannerName.textContent.replace('Viewing: ', '') : 'My Activity';
    dateEl.textContent = this._formatHistoryDate(dateKey);

    // Summary stats
    const kp = log.kpEarned || 0;
    const isPerfect = log.perfectDay;
    summaryEl.innerHTML = `
      <span class="day-detail-kp">+${kp} AP</span>
      ${isPerfect ? '<span class="day-detail-badge">⭐ Perfect Day</span>' : ''}
    `;

    // Activity grid
    const activities = [
      { key: 'enableNavkarsi', icon: '🌅', name: 'Navkarsi', done: !!log.navkarsiDone },
      { key: 'enableWakeup', icon: '⏰', name: 'Wake < 7AM', done: !!log.wakeUpDone },
      { key: 'enableSleep', icon: '🌙', name: 'Sleep < 12AM', done: !!log.sleepDone },
      { key: 'enablePranam', icon: '🙇', name: 'Pranam', done: !!log.pranamDone },
      { key: 'enablePooja', icon: '🪔', name: 'Pooja', done: !!log.poojaDone, extra: log.ashtaPrakariDone ? '+Ashta' : '' },
      { key: 'enableSamayik', icon: '🧘', name: 'Samayik', done: (log.samayikDone || 0) > 0, val: `${log.samayikDone || 0}` },
      { key: 'enablePratikraman', icon: '🌅', name: 'Devasiya', done: !!log.devasiyaDone },
      { key: 'enablePratikraman', icon: '🌙', name: 'Raysiya', done: !!log.raysiyaDone },
      { key: 'enableBookReading', icon: '📖', name: 'Book Reading', done: (log.bookReadingMins || 0) >= 30, val: `${log.bookReadingMins || 0} min` },
      { key: 'enableRatriBhojan', icon: '🍽️', name: 'Ratri Bhojan Tyag', done: !!log.ratriBhojanDone },
      { key: 'enableKandmool', icon: '🌱', name: 'Kandmool Tyag', done: !!log.kandmoolDone },
      { key: 'enableScreenTime', icon: '📱', name: 'Screen Time', done: false, val: `${log.screenTimeHours || 0}h ${log.screenTimeMins || 0}m` },
      { key: 'enableDailyNiyam', icon: '✨', name: 'Daily Niyam', done: !!log.dailyNiyamDone },
    ];

    gridEl.innerHTML = activities
      .filter(a => s[a.key])
      .map(a => `
        <div class="day-detail-item ${a.done ? 'done' : 'missed'}">
          <span class="day-detail-icon">${a.icon}</span>
          <span class="day-detail-name">${a.name}</span>
          <span class="day-detail-status">${a.val ? a.val : (a.done ? '✓' : '✗')}${a.extra ? ' ' + a.extra : ''}</span>
        </div>
      `).join('');

    overlay.classList.remove('hidden');
    overlay.classList.add('show');
    this._openDayDetailKey = dateKey;
  }

  closeDayDetail() {
    this._openDayDetailKey = null;
    const o = document.getElementById('day-detail-overlay');
    if (o) { o.classList.remove('show'); o.classList.add('hidden'); }
  }

  // ===== STREAK SAVER — PAST-DAY EDIT OVERLAY =====
  // Opens the dedicated edit overlay for a past day inside the streak-saver
  // window. The draft is a standalone object, never `this.dailyLog` — so
  // nothing here can be touched by today's realtime listener or the
  // midnight rollover, and nothing the editor does can leak into today's
  // live log.
  openDayEdit(dateKey) {
    if (this.currentRole !== 'user') return;
    if (!this._isStreakSaverEligible(dateKey)) return;
    if (this._streakSaversLeft() <= 0) return;

    const overlay = document.getElementById('day-edit-overlay');
    if (!overlay) return;

    const existing = (this._cachedDailyLogs && this._cachedDailyLogs[dateKey]) || null;
    this._dayEditKey = dateKey;
    this._dayEditOriginal = existing ? { ...DEFAULT_DAILY_LOG, ...existing } : { ...DEFAULT_DAILY_LOG, date: dateKey };
    this._dayEditDraft = { ...this._dayEditOriginal };

    const dateEl = document.getElementById('day-edit-date');
    if (dateEl) dateEl.textContent = this._formatHistoryDate(dateKey);
    const errEl = document.getElementById('day-edit-error');
    if (errEl) errEl.classList.add('hidden');

    this._renderDayEditRows();
    overlay.classList.remove('hidden');
    overlay.classList.add('show');
  }

  closeDayEdit() {
    this._dayEditKey = null;
    this._dayEditOriginal = null;
    this._dayEditDraft = null;
    const o = document.getElementById('day-edit-overlay');
    if (o) { o.classList.remove('show'); o.classList.add('hidden'); }
  }

  _renderDayEditRows() {
    const gridEl = document.getElementById('day-edit-grid');
    const draft = this._dayEditDraft;
    if (!gridEl || !draft) return;
    const s = this.settings || DEFAULT_SETTINGS;

    gridEl.innerHTML = DAY_EDIT_FIELDS.filter(f => s[f.key]).map(f => {
      if (f.type === 'toggle') {
        const disabled = !!(f.dependsOn && !draft[f.dependsOn]);
        const checked = !disabled && !!draft[f.prop];
        return `
          <div class="day-edit-row${disabled ? ' day-edit-row-disabled' : ''}">
            <span class="day-edit-icon">${f.icon}</span>
            <span class="day-edit-label">${f.label}</span>
            <button type="button" class="day-edit-toggle-btn${checked ? ' is-on' : ''}" data-prop="${f.prop}"${disabled ? ' disabled' : ''}>${checked ? '✓ Done' : 'Not done'}</button>
          </div>`;
      }
      if (f.type === 'counter') {
        const val = draft[f.prop] || 0;
        const display = f.unit === 'min' ? `${val} min` : `${val}`;
        return `
          <div class="day-edit-row">
            <span class="day-edit-icon">${f.icon}</span>
            <span class="day-edit-label">${f.label}</span>
            <div class="day-edit-counter">
              <button type="button" class="day-edit-counter-btn" data-prop="${f.prop}" data-step="${-f.step}">−</button>
              <span class="day-edit-counter-val">${display}</span>
              <button type="button" class="day-edit-counter-btn" data-prop="${f.prop}" data-step="${f.step}">+</button>
            </div>
          </div>`;
      }
      // screentime — whole hours only, mirroring adjustScreenTime()'s live UI
      const hrs = draft.screenTimeHours || 0;
      return `
        <div class="day-edit-row">
          <span class="day-edit-icon">${f.icon}</span>
          <span class="day-edit-label">${f.label}</span>
          <div class="day-edit-counter">
            <button type="button" class="day-edit-counter-btn" data-prop="screenTimeHours" data-step="-1">−</button>
            <span class="day-edit-counter-val">${hrs}h</span>
            <button type="button" class="day-edit-counter-btn" data-prop="screenTimeHours" data-step="1">+</button>
          </div>
        </div>`;
    }).join('');

    gridEl.querySelectorAll('.day-edit-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const prop = btn.dataset.prop;
        draft[prop] = !draft[prop];
        if (prop === 'poojaDone' && !draft[prop]) draft.ashtaPrakariDone = false;
        this._renderDayEditRows();
      });
    });
    gridEl.querySelectorAll('.day-edit-counter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const prop = btn.dataset.prop;
        const step = parseInt(btn.dataset.step, 10);
        draft[prop] = Math.max(0, (draft[prop] || 0) + step);
        this._renderDayEditRows();
      });
    });
  }

  // Persists the edited day, then reconciles totalKP, perfect-day count,
  // per-niyam lifetime stats, and the streak — all as deltas against the
  // original log, never as blind overwrites, so nothing but the edited
  // day's own contribution changes.
  async saveDayEdit() {
    const dateKey = this._dayEditKey;
    const draft = this._dayEditDraft;
    const before = this._dayEditOriginal;
    if (!dateKey || !draft || !before) return;
    if (!this._isStreakSaverEligible(dateKey)) { this.closeDayEdit(); return; }
    if (this._streakSaversLeft() <= 0) return;

    const s = this.settings || DEFAULT_SETTINGS;
    // Normalize: Ashta only ever scores alongside Pooja, matching the live
    // toggleAshtaPrakari() behavior — never mint points the live path wouldn't.
    if (!draft.poojaDone) draft.ashtaPrakariDone = false;

    const oldKp = computeRawDayPoints(before);
    const newKp = computeRawDayPoints(draft);
    draft.kpEarned = newKp;

    const wasPerfect = !!before.perfectDay;
    const isPerfect = this._isLogComplete(draft, s);
    draft.perfectDay = isPerfect;
    draft.finalized = true;

    try {
      await this.saveDailyLogFor(dateKey, draft);
    } catch (e) {
      console.warn('Streak-saver edit failed to save — chance not consumed.', e);
      const errEl = document.getElementById('day-edit-error');
      if (errEl) { errEl.textContent = 'Failed to save. Please try again.'; errEl.classList.remove('hidden'); }
      return;
    }

    this.profile.totalKP = Math.max(0, (this.profile.totalKP || 0) + (newKp - oldKp));

    if (isPerfect && !wasPerfect) this.profile.totalPerfectDays = (this.profile.totalPerfectDays || 0) + 1;
    else if (!isPerfect && wasPerfect) this.profile.totalPerfectDays = Math.max(0, (this.profile.totalPerfectDays || 0) - 1);

    const statDelta = (statKey, beforeVal, afterVal) => {
      this.profile[statKey] = Math.max(0, (this.profile[statKey] || 0) + (afterVal - beforeVal));
    };
    statDelta('totalSamayik', before.samayikDone || 0, draft.samayikDone || 0);
    statDelta('totalSwadhyay', Math.floor((before.bookReadingMins || 0) / 30), Math.floor((draft.bookReadingMins || 0) / 30));
    statDelta('totalNiyam', before.dailyNiyamDone ? 1 : 0, draft.dailyNiyamDone ? 1 : 0);
    statDelta('totalDevasiya', before.devasiyaDone ? 1 : 0, draft.devasiyaDone ? 1 : 0);
    statDelta('totalRaysiya', before.raysiyaDone ? 1 : 0, draft.raysiyaDone ? 1 : 0);
    // earlyPooja and totalActivities are deliberately left untouched — neither
    // can be reconstructed for a past day without guessing (earlyPooja needs
    // the actual wall-clock completion time; totalActivities has no clean
    // per-log definition).

    // Recompute the streak against logs with this edit merged in. Using
    // max() rather than overwriting means a streak saver can only ever help:
    // the streak-freeze feature can leave currentStreak legitimately higher
    // than history implies (it forgives one missed day per month without
    // recording which one), and a blind overwrite would silently erase that.
    const mergedLogs = { ...(this._cachedDailyLogs || {}), [dateKey]: draft };
    this._cachedDailyLogs = mergedLogs;
    const recomputed = this._recomputeStreakFromHistory(mergedLogs);
    this.profile.currentStreak = Math.max(recomputed, this.profile.currentStreak || 0);
    if (this.profile.currentStreak > (this.profile.longestStreak || 0)) {
      this.profile.longestStreak = this.profile.currentStreak;
    }

    this._consumeStreakSaver();
    await this.saveProfile();

    this.closeDayEdit();
    this.renderDashboard();
    this.renderAchievements();
    this.renderHistory();
    this.checkBadges();
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
    if (tabName === 'profile') this.renderProfile();
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
    const p = this.profile;

    // Badges earned
    const badgeCount = (p.badges || []).length;
    document.getElementById('admin-user-level-icon').textContent = '🏅';
    document.getElementById('admin-user-level').textContent = `${badgeCount} Badge${badgeCount === 1 ? '' : 's'} Earned`;
    document.getElementById('admin-user-kp').textContent = `${p.totalKP} AP`;
    document.getElementById('admin-user-streak').textContent = `${p.currentStreak} day streak`;
    const flame = document.getElementById('admin-user-streak-flame');
    const st = p.currentStreak;
    if (st >= 30) flame.textContent = '✨🔥✨';
    else if (st >= 14) flame.textContent = '🔥🔥🔥';
    else if (st >= 7) flame.textContent = '🔥🔥';
    else if (st >= 3) flame.textContent = '🔥';
    else flame.textContent = '🕯️';

    // Today's Activities and Lifetime Stats were removed here in favour of the
    // Monthly Niyam Stats overlay (renderNiyamStats()) — the former duplicated
    // what clicking a day in Activity History already shows, and the latter's
    // all-time totals said little about recent practice.

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
    const unlockBtn = document.getElementById('btn-unlock-day');

    if (locked) {
      const byLabel = { user: 'the user', admin: 'you (admin)', auto: 'auto-lock at midnight' }[this._lockedBy()] || 'unknown';
      icon.textContent = '🔒';
      text.innerHTML = `Today is <strong>locked</strong> (by ${byLabel}). User cannot modify activities.`;
      card.classList.add('locked');
      btn.disabled = true;
      btn.textContent = '🔒 Already Locked';
      if (unlockBtn) unlockBtn.disabled = false;
    } else {
      icon.textContent = '🔓';
      text.innerHTML = 'Today is <strong>unlocked</strong>. User can still modify activities.';
      card.classList.remove('locked');
      btn.disabled = false;
      btn.textContent = '🔒 Lock Today\'s Submissions';
      if (unlockBtn) unlockBtn.disabled = true;
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
      s.enablePratikraman ? `<div class="lock-preview-item"><span>🌅 Devasiya:</span> <strong>${d.devasiyaDone ? '✓' : '✗'}</strong></div>` : '',
      s.enablePratikraman ? `<div class="lock-preview-item"><span>🌙 Raysiya:</span> <strong>${d.raysiyaDone ? '✓' : '✗'}</strong></div>` : '',
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
    if (confirm('🔒 Lock today\'s submissions? The user will no longer be able to modify today\'s activities unless you unlock it.')) {
      this.lockDay();
      this.renderAdminLock();
      this.renderAdminProgress();
    }
  }

  adminUnlockDay() {
    if (!this.isDayLocked()) return;
    if (confirm('🔓 Unlock today\'s submissions? The user will be able to modify today\'s activities again.')) {
      db.ref(`users/${this.uid}/lock_status/${this.getTodayKey()}`).remove();
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

    // Clear error
    const loginErr = document.getElementById('login-error');
    if (loginErr) loginErr.classList.add('hidden');
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
