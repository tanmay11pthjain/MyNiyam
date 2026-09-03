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
// Profile photos stay inline at users/{uid}/photo (base64 data URL) —
// Firebase Cloud Storage requires the paid Blaze plan, which this project
// doesn't use. They're private in v5 regardless: users/$uid is readable
// only by that member, their own family profiles, and their sangh's
// admins (see firebase-rules.json).

// ===== RAW NIYAM POINTS — single source of truth =====
// What a day's raw points are, derived purely from what was actually done
// that day (a point value × the relevant flag/counter). No streak
// multiplier, no Perfect Day bonus, no daily-login bonus — none of those
// are part of the score anymore. The live award path (activity handlers),
// the historical recompute (_migrateToRawPoints), and the admin Excel
// export all read from this same list, so they can never disagree on what
// "raw points" means.
//
// Each rule carries a stable `key` (matches either a POINTS key or a
// NIYAM_REGISTRY item's `prop`) and reads its value from the PASSED map
// `P` rather than closing over POINTS directly — admin-side aggregates
// (the Excel export, the poster) can span members of DIFFERENT sanghs with
// different point overrides in one pass, so a single mutated global would
// score everyone at whichever sangh's map happened to be applied last. A
// logged-in user belongs to exactly one sangh, so their call sites simply
// omit P and get their own live map — see livePoints() below.
//
// Ashta Prakari only ever scores alongside Pooja — matching the live award
// path (completePooja()/toggleAshtaPrakari()) and the day-edit dependsOn
// rule (DAY_EDIT_FIELDS above). Raiya has its OWN key (not devasiya's) so
// the two can be priced independently — see completePratikraman() below.
// Populated entirely by registerNiyams() from NIYAM_REGISTRY (data.js) —
// every niyam, built-in and custom alike. Nothing is hand-written here: a
// niyam's scoring shape comes from its item's `type` (toggle / counter /
// duration / screentime), so adding one can never leave it unscored.
const RAW_POINT_RULES = [];

// A day's total raw points — the same figure used for kpEarned everywhere.
// `P` defaults to the caller's own live point map (see livePoints()) so
// every single-sangh call site can simply omit it; admin aggregates that
// span multiple sanghs pass each member's own resolved map explicitly.
function computeRawDayPoints(log, P) {
  const map = P || livePoints();
  return RAW_POINT_RULES.reduce((sum, rule) => sum + rule.points(log, map), 0);
}

// ===== ADMIN-CONFIGURABLE POINT VALUES (per sangh) =====
// DEFAULT_POINT_MAP is a frozen snapshot of the CODED defaults — POINTS
// (data.js) for the 13 built-in niyams, plus every successfully-registered
// NIYAM_REGISTRY item's `points`, keyed by its `prop`. Registry props are
// enforced globally unique and always end in "Done" (registerNiyams()'s
// PROP_RE), so they can never collide with a POINTS key — one flat map is
// safe. Built AFTER registerNiyams() runs (below), both because it needs
// `entry.flag` to know which entries actually survived validation, and
// because it must capture the truly-original defaults before any override
// is ever applied.
let DEFAULT_POINT_MAP = null;
let _livePointMap = null;

function _buildDefaultPointMap() {
  const map = { ...POINTS };
  (typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : []).forEach(entry => {
    if (!entry.flag) return; // failed registerNiyams() validation — no rule exists for it
    // Keyed by pointsKey (registerNiyams() normalises it to `prop` when the
    // entry doesn't pin one), because that is what a sangh's stored point
    // overrides and the admin-points-{key} inputs are keyed by.
    entry.items.forEach(item => { map[item.pointsKey || item.prop] = item.points; });
  });
  return map;
}

// Merges a sangh's stored point overrides onto the coded defaults. Any
// value that is missing, non-numeric or negative is dropped rather than
// applied — a blank/garbled/negative admin input must never poison
// scoring. A deliberate 0 IS allowed: the niyam still counts toward
// streaks/perfect-day/stats, it just scores no points. Never mutates
// DEFAULT_POINT_MAP itself.
function resolvePointMap(overrides) {
  const map = { ...DEFAULT_POINT_MAP };
  Object.entries(overrides || {}).forEach(([key, val]) => {
    if (!(key in map)) return; // unknown/stale key — ignore rather than pollute the map
    const n = Number(val);
    if (Number.isFinite(n) && n >= 0) map[key] = n;
  });
  return map;
}

// The map currently in effect for THIS session — a user's own sangh's
// resolved map (set by the sangh_config listener in setupRealtimeSync()),
// or the coded defaults before that listener has resolved for the first
// time / for a session with no sangh at all.
function livePoints() {
  return _livePointMap || DEFAULT_POINT_MAP;
}

function setLivePoints(map) {
  _livePointMap = map;
}

// Resolves a sangh's effective niyam settings: DEFAULT_SETTINGS overlaid by
// that sangh's OWN sangh_config/{code}/settings. v4 had a third layer in
// the middle — a legacy global `settings` node shared by every sangh
// before per-sangh settings existed — which is gone in v5: every sangh's
// config is seeded/saved with every registry flag explicit (see
// seed-v5.js), so there is nothing left for a middle fallback layer to
// contribute, and a stale global default can no longer silently win over
// a sangh's own choice for a niyam it never happened to re-save.
function resolveSettings(sanghNode) {
  return {
    ...DEFAULT_SETTINGS,
    ...((sanghNode && sanghNode.settings) || {}),
  };
}

// ===== STREAK SAVER — PAST-DAY EDIT FIELD SPEC =====
// Drives the day-edit overlay's rows. 'toggle' fields flip a boolean prop;
// 'counter' fields step a numeric prop by `step`; 'screentime' steps whole
// hours only, matching the live dashboard (screenTimeMins is never adjusted
// there either, so raw-point math stays identical between an edited day and
// a live one). Ashta Prakari's `dependsOn` mirrors the live rule that it
// only ever scores alongside Pooja (toggleAshtaPrakari()).
const DAY_EDIT_FIELDS = [];

// ===== MONTHLY NIYAM STATS — pure per-niyam spec =====
// Single source of truth for "days/times followed" — shared by the Monthly
// Niyam Stats overlay, the lifetime stats grid (user Badges tab + admin
// History), and the admin Excel export. Every niyam gets
// `countsDay(log, settings)` — did it count as followed that day; a
// counter/duration niyam also gets `amount(log)` (the raw quantity to sum)
// and `formatAmount(total)` (how to display that sum). Entries marked
// `penalty: true` (Screen Time) are excluded from the Monthly Niyam Stats
// overlay specifically — it's a penalty, not something "followed" — but DO
// appear in the lifetime grid and the export, where the raw amount is still
// useful context. A spec with `amount` displays that amount everywhere;
// otherwise it displays `days`.
const NIYAM_STATS = [];

// ===== NIYAM REGISTRY — derive every wiring from NIYAM_REGISTRY (data.js) =====
// Registering a niyam there makes it participate in scoring (RAW_POINT_RULES),
// the streak-saver day-edit overlay (DAY_EDIT_FIELDS), and Monthly Niyam
// Stats / the lifetime grid / the Excel export (NIYAM_STATS) — all three
// consumers already iterate these arrays generically, so pushing an ordinary
// entry into each is enough; none of those consumers need to change. This
// function ONLY derives into module-level data; it never touches the DOM —
// card rendering is _renderRegistryCards() (KalyanMitra.prototype), a
// separate step run once per dashboard load.
//
// Validation is strict and non-fatal: a malformed entry is logged and
// skipped rather than thrown. A single typo'd registry entry silently taking
// down the whole dashboard is exactly the outage class this guards against
// (see renderHeader()'s history with the removed streak markup) — every
// entry here is independently either fully wired or fully ignored.
// Shared by the 'duration' and 'screentime' item types — both report an
// amount in minutes and must format it identically wherever it surfaces
// (Monthly Stats, the lifetime grid, the Excel export).
function _formatMinutes(totalMins) {
  const h = Math.floor(totalMins / 60), m = totalMins % 60;
  return h > 0 ? `${h}h${m > 0 ? ' ' + m + 'm' : ''}` : `${m}m`;
}

// Total screen-time minutes across an item's hours prop and its sibling
// minutes prop — the penalty is charged per WHOLE hour of the combined
// figure, so 59m costs nothing and 1h30m costs exactly one hour's penalty.
function _screenTimeMinutes(item, log) {
  return ((log[item.prop] || 0) * 60) + ((item.minsProp ? log[item.minsProp] : 0) || 0);
}

// Every NIYAM_REGISTRY entry registerNiyams() had to skip, with a
// human-readable reason — so a bad edit to data.js is loud in the admin
// panel (see _renderNiyamRegistryErrors()), not just a console.error only
// the person who opened devtools would ever see. Populated once, below.
const NIYAM_REGISTRY_ERRORS = [];

function registerNiyams() {
  const usedIds = new Set();
  // DEFAULT_DAILY_LOG now ships with only the non-niyam bookkeeping fields
  // (date/kpEarned/perfectDay/…), so this is exactly the reserved set a
  // niyam prop must not collide with.
  const usedProps = new Set(Object.keys(DEFAULT_DAILY_LOG));
  const ID_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
  const DONE_PROP_RE = /^[a-zA-Z][a-zA-Z0-9]*Done$/;
  const PLAIN_PROP_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
  const LAYOUTS = ['simple', 'dual', 'dependent', 'exclusive'];
  const SECTIONS = ['bhakti', 'aachar', 'morning', 'sadhana', 'tyag'];
  const TYPES = ['toggle', 'counter', 'duration', 'screentime'];

  (typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : []).forEach(entry => {
    try {
      if (!entry || typeof entry !== 'object') throw new Error('entry is not an object');
      if (!ID_RE.test(entry.id || '')) throw new Error(`invalid id "${entry.id}"`);
      if (usedIds.has(entry.id)) throw new Error(`duplicate id "${entry.id}"`);
      if (!SECTIONS.includes(entry.section)) throw new Error(`invalid section "${entry.section}"`);
      if (!LAYOUTS.includes(entry.layout)) throw new Error(`invalid layout "${entry.layout}"`);
      if (!Array.isArray(entry.items) || entry.items.length === 0) throw new Error('items must be a non-empty array');
      // 'dependent' is always exactly a parent + one child. 'dual'/'exclusive'
      // allow ANY number of slots >= 2 (e.g. Tapasya's 4 tap levels) — every
      // consumer (the card builder, the exclusive-select handler, admin row
      // generation, sub-flag derivation below) already loops over entry.items
      // rather than assuming 2, so N-way "just works" once validation allows it.
      if (entry.layout === 'dependent' && entry.items.length !== 2) {
        throw new Error('layout "dependent" requires exactly 2 items');
      }
      if ((entry.layout === 'dual' || entry.layout === 'exclusive') && entry.items.length < 2) {
        throw new Error(`layout "${entry.layout}" requires at least 2 items`);
      }
      if (entry.layout === 'simple' && entry.items.length !== 1) {
        throw new Error('layout "simple" requires exactly 1 item');
      }

      const seenPropsThisEntry = new Set();
      entry.items.forEach(item => {
        if (!item || typeof item !== 'object') throw new Error('item is not an object');
        const type = item.type || 'toggle';
        if (!TYPES.includes(type)) throw new Error(`invalid type "${type}" for "${item.prop}"`);
        // Boolean niyams keep the strict "…Done" convention — that suffix is
        // what marks a prop as a toggle at a glance across the whole log.
        // The numeric types (a count, minutes, screen-time hours) legitimately
        // don't end in "Done", so they only have to be a plain identifier.
        const re = type === 'toggle' ? DONE_PROP_RE : PLAIN_PROP_RE;
        if (!re.test(item.prop || '')) throw new Error(`invalid prop "${item.prop}" for type "${type}"`);
        if (usedProps.has(item.prop)) throw new Error(`duplicate/reserved prop "${item.prop}"`);
        if (item.minsProp) {
          if (!PLAIN_PROP_RE.test(item.minsProp)) throw new Error(`invalid minsProp "${item.minsProp}"`);
          if (usedProps.has(item.minsProp)) throw new Error(`duplicate/reserved minsProp "${item.minsProp}"`);
        }
        if (type === 'duration' && !(Number.isFinite(item.divisor) && item.divisor > 0)) {
          throw new Error(`type "duration" requires a positive divisor for "${item.prop}"`);
        }
        if (type === 'screentime' && !item.minsProp) {
          throw new Error(`type "screentime" requires minsProp for "${item.prop}"`);
        }
        if (!item.label) throw new Error(`missing label for "${item.prop}"`);
        if (!Number.isFinite(item.points) || item.points <= 0) throw new Error(`invalid points for "${item.prop}"`);
        seenPropsThisEntry.add(item.prop);
        if (item.minsProp) seenPropsThisEntry.add(item.minsProp);
      });
      if (entry.layout === 'dependent') {
        const child = entry.items[1];
        if (!child.dependsOn || child.dependsOn !== entry.items[0].prop) {
          throw new Error(`layout "dependent" requires items[1].dependsOn === items[0].prop`);
        }
      }

      // All validated — commit this entry's derived wiring. Nothing above
      // this line has mutated shared state, so a thrown entry leaves no
      // partial trace in any catalog.
      usedIds.add(entry.id);
      seenPropsThisEntry.forEach(p => usedProps.add(p));
      // Explicit `flag` wins: the built-ins' settings keys (enableBookReading,
      // enableScreenTime, enableDailyNiyam, …) are long-standing per-sangh
      // stored data and don't match the enable<Id> derivation.
      entry.flag = entry.flag || ('enable' + entry.id.charAt(0).toUpperCase() + entry.id.slice(1));

      entry.items.forEach((item, idx) => {
        const type = item.type || 'toggle';
        // The points key is what a sangh's stored overrides are keyed by, so
        // it defaults to `prop` (every pre-existing custom niyam) but the
        // built-ins pin their own historical keys (navkarsi, wakeUpEarly, …).
        const pointsKey = item.pointsKey || item.prop;
        item.pointsKey = pointsKey; // normalised so _buildDefaultPointMap() and the UI can rely on it

        // A toggle logs a boolean; every numeric type starts at 0.
        DEFAULT_DAILY_LOG[item.prop] = (type === 'toggle') ? false : 0;
        if (item.minsProp) DEFAULT_DAILY_LOG[item.minsProp] = 0;

        // Every item after the first (the "parent") is a "sub" niyam
        // _renderAdminNiyamRows() renders as its own indented row — give
        // each one its OWN flag so an admin can switch it off
        // independently, instead of it riding entry.flag. For the
        // built-ins' sub-items this defaults true (unlike entry.flag
        // below, which defaults false) — they've been live under their
        // parent for every existing sangh, so a settings object merged as
        // {...DEFAULT_SETTINGS, ...snap.val()} must fall back to "still
        // on" for a sangh saved before this change. A brand-new entry's
        // sub-items default true too — harmless, since the whole card
        // stays hidden until its own entry.flag (defaultEnabled) is
        // switched on, at which point showing every option by default is
        // the sensible starting point. An explicit item.flag wins for the
        // same stored-data reason as entry.flag above.
        if (idx >= 1) {
          const base = item.prop.replace(/Done$/, '');
          item.flag = item.flag || ('enable' + base.charAt(0).toUpperCase() + base.slice(1));
          item.parentFlag = entry.flag;
          DEFAULT_SETTINGS[item.flag] = true;
        }

        const flag = item.flag || entry.flag;
        const parentFlag = item.flag ? item.parentFlag : undefined;
        const icon = item.icon || entry.icon;

        // ----- scoring -----
        let pointsFn;
        if (type === 'counter') {
          pointsFn = (log, P) => (log[item.prop] || 0) * P[pointsKey];
        } else if (type === 'duration') {
          pointsFn = (log, P) => Math.floor((log[item.prop] || 0) / item.divisor) * P[pointsKey];
        } else if (type === 'screentime') {
          // Negative by definition — the only rule that subtracts.
          pointsFn = (log, P) => -(Math.floor(_screenTimeMinutes(item, log) / 60) * P[pointsKey]);
        } else {
          pointsFn = (log, P) => {
            if (!log[item.prop]) return 0;
            if (item.dependsOn && !log[item.dependsOn]) return 0;
            return P[pointsKey];
          };
        }
        RAW_POINT_RULES.push({ key: pointsKey, label: item.label, points: pointsFn });

        // ----- streak-saver day-edit overlay -----
        // 'counter' and 'duration' share the overlay's stepper control; only
        // screen time needs its own hours/minutes widget.
        const editType = type === 'screentime' ? 'screentime'
          : (type === 'counter' || type === 'duration') ? 'counter'
          : 'toggle';
        DAY_EDIT_FIELDS.push({
          key: flag, parentFlag, prop: item.prop, icon, label: item.label,
          type: editType, step: item.step, unit: item.unit, dependsOn: item.dependsOn
        });

        // ----- Monthly Stats / lifetime grid / Excel export -----
        const spec = { flag, parentFlag, icon, label: item.label };
        if (type === 'counter') {
          spec.exportUnit = item.exportUnit || 'times';
          // targetSetting lets a counter define "followed" as a threshold an
          // admin controls (Samayik's samayikTarget). Without one, any count
          // of 1 or more counts as followed.
          spec.countsDay = (log, s) => (log[item.prop] || 0) >= parseInt((s && item.targetSetting && s[item.targetSetting]) || 1, 10);
          spec.amount = log => log[item.prop] || 0;
          spec.formatAmount = total => `${total} time${total === 1 ? '' : 's'}`;
        } else if (type === 'duration') {
          spec.exportUnit = item.exportUnit || 'mins';
          spec.countsDay = log => (log[item.prop] || 0) >= item.divisor;
          spec.amount = log => log[item.prop] || 0;
          spec.formatAmount = _formatMinutes;
        } else if (type === 'screentime') {
          spec.penalty = true;
          spec.exportUnit = item.exportUnit || 'mins';
          spec.countsDay = () => false; // a penalty is never "followed"
          spec.amount = log => _screenTimeMinutes(item, log);
          spec.formatAmount = _formatMinutes;
        } else if (item.dependsOn && item.countsWithoutParent) {
          // Preserves long-standing built-in behaviour for Ashta Prakari: it
          // scores 0 without Jin Pooja (see pointsFn above) yet has always
          // still counted as "followed" here. That is arguably inconsistent
          // with the identical registry mechanism (Chaitya Vandan DOES gate),
          // but changing it would silently rewrite what members see for days
          // already logged, so it stays opt-in and explicit rather than being
          // quietly "fixed" during a refactor.
          spec.countsDay = log => !!log[item.prop];
        } else {
          spec.countsDay = log => !!log[item.prop] && (!item.dependsOn || !!log[item.dependsOn]);
        }
        NIYAM_STATS.push(spec);
      });

      // Built-ins ship on; a newly added niyam ships off until a sangh admin
      // opts it in from Settings.
      DEFAULT_SETTINGS[entry.flag] = entry.defaultEnabled === true;
    } catch (e) {
      console.error(`Skipping invalid NIYAM_REGISTRY entry (id: ${entry && entry.id}):`, e.message);
      NIYAM_REGISTRY_ERRORS.push({ id: (entry && entry.id) || '(no id)', message: e.message });
    }
  });
}
registerNiyams();
DEFAULT_POINT_MAP = _buildDefaultPointMap();

// ===== ANDROID BACK BUTTON — overlay-close + tab-step navigation =====
// Every overlay id this app has, mapped to its dedicated close method (see
// each overlay's own open*/close* pair, e.g. openDayDetail()/closeDayDetail()
// near line 4900). The back button and Escape both route through this map so
// they always run the SAME cleanup a ✕ click would (clearing
// _openDayDetailKey, chaining to the next badge, etc.) — never just a bare
// hide. An id missing here, or whose method no longer exists, falls back to
// a direct hide in _navCloseOverlayById() rather than throwing.
const OVERLAY_CLOSERS = {
  'day-detail-overlay': 'closeDayDetail',
  'day-edit-overlay': 'closeDayEdit',
  'badge-unlock-overlay': 'closeBadgeUnlock',
  'submit-confirm-overlay': 'closeSubmitConfirm',
  'sangh-transfer-overlay': 'closeSanghTransferNotice',
  'photo-prompt-overlay': 'closePhotoPromptOverlay',
  'profile-switcher-overlay': 'closeProfileSwitcher',
  'export-overlay': 'closeExportDialog',
  'attendance-export-overlay': 'closeAttendanceExportDialog',
  'poster-overlay': 'closePosterOverlay',
  'niyam-stats-overlay': 'closeNiyamStats',
  'evening-summary-overlay': 'closeEveningSummary',
  'logout-confirm-overlay': 'closeLogoutConfirm',
};

// The only tab names switchTab()/switchAdminTab() may ever act on — a
// history entry's `tab` field could in principle be anything (a stale entry
// from a future version, a foreign one), so back-driven tab switching
// (_navSwitchToTab()) checks against these before touching the DOM at all.
const USER_TABS = ['home', 'history', 'achievements', 'profile'];
const ADMIN_TABS = ['admin-leaderboard', 'admin-settings', 'admin-progress', 'admin-attendance'];

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
    this._landingStats = null;
    this._landingStatsAnimated = false;
    this._landingReady = false; // set by _ensureLandingReady() — guards it against re-entry
    this._loadingRetryTimer = null;
    this._openOverlayStack = []; // overlay ids currently open, most-recently-opened last
    this._navHandlingPop = false; // true only while _navOnPopState() itself is running
    this._adminSettingsDirty = false; // true while the admin Settings tab has an unsaved edit — see loadAdminSettingsUI()
    // init() is the critical path (auth) and must start first, unconditionally.
    // _initLanding() is purely decorative — wrapped so any exception in it can
    // never prevent auth from running.
    this.init();
    try {
      this._initLanding();
    } catch (e) {
      console.error('Landing page setup failed (non-fatal):', e);
    }
    try {
      this._initLoadingScreenRetry();
    } catch (e) {
      console.error('Loading screen retry setup failed (non-fatal):', e);
    }
    try {
      this._initNavHistory();
    } catch (e) {
      console.error('Back-button navigation setup failed (non-fatal):', e);
    }
    try {
      this._initLogoutConfirm();
    } catch (e) {
      console.error('Logout confirmation setup failed (non-fatal):', e);
    }
    try {
      this._initProfileSwitcher();
    } catch (e) {
      console.error('Profile switcher setup failed (non-fatal):', e);
    }
    try {
      this._initInstallBanner();
    } catch (e) {
      console.error('Install banner setup failed (non-fatal):', e);
    }
  }

  // Binds the shared logout-confirmation overlay's Cancel/Confirm buttons
  // once, here — that overlay is reused by BOTH the user and admin logout
  // buttons (see setupUserEventListeners()/setupAdminEventListeners()), but
  // only one of those two ever runs per session (a session is either a user
  // or an admin, never both), so neither is a reliable place to bind
  // something shared. The constructor is the one place guaranteed to run
  // exactly once regardless of role.
  _initLogoutConfirm() {
    const cancelBtn = document.getElementById('btn-cancel-logout');
    const confirmBtn = document.getElementById('btn-confirm-logout');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeLogoutConfirm());
    if (confirmBtn) confirmBtn.addEventListener('click', () => {
      // Closes first so the dialog visibly dismisses before the page
      // transitions to the landing screen, not after.
      this.closeLogoutConfirm();
      this.logout();
    });
  }

  openLogoutConfirm() {
    const overlay = document.getElementById('logout-confirm-overlay');
    if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('show'); }
  }

  closeLogoutConfirm() {
    const overlay = document.getElementById('logout-confirm-overlay');
    if (overlay) { overlay.classList.remove('show'); overlay.classList.add('hidden'); }
  }

  // ===== PWA INSTALL REMINDER =====
  // See #pwa-install-banner in index.html and its CSS in styles.css — a
  // dismissible BOTTOM banner (never top — #db-error-banner already owns
  // the top at z-index 1090, and the two must never collide) nudging a
  // phone visitor to install the app. Deliberately has no service worker
  // behind it (see manifest.json's own comment) — Chrome may not fire
  // beforeinstallprompt without one, in which case Android falls back to
  // the same manual "Add to Home Screen" instructions iOS always needs,
  // rather than showing a button that would do nothing.
  _isStandaloneDisplay() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  _isIOSDevice() {
    // iPadOS 13+ reports as "MacIntel" but is touch-capable, unlike a real Mac.
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  _isLikelyPhone() {
    return window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;
  }

  // Binds the banner's buttons once, here (constructor time) — mirrors
  // _initLogoutConfirm() just above. beforeinstallprompt can fire before OR
  // after the dashboard is visible, so it's captured here regardless of
  // role/screen, and _updateInstallBanner() (called separately once the
  // dashboard actually renders — see initUser()) is what decides whether to
  // actually show anything.
  _initInstallBanner() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._deferredInstallPrompt = e;
      this._updateInstallBanner();
    });
    window.addEventListener('appinstalled', () => {
      this._deferredInstallPrompt = null;
      const banner = document.getElementById('pwa-install-banner');
      if (banner) banner.classList.add('hidden');
    });

    const installBtn = document.getElementById('btn-pwa-install');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!this._deferredInstallPrompt) return;
        const promptEvent = this._deferredInstallPrompt;
        this._deferredInstallPrompt = null;
        installBtn.disabled = true;
        try {
          promptEvent.prompt();
          await promptEvent.userChoice;
        } catch (e) { /* native prompt dismissed/failed — non-fatal */ }
        installBtn.disabled = false;
        this._updateInstallBanner();
      });
    }

    const dismissBtn = document.getElementById('btn-pwa-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        try { localStorage.setItem('myniyam_installBannerDismissedAt', String(Date.now())); } catch (e) { /* storage full/unavailable — non-fatal */ }
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.classList.add('hidden');
      });
    }
  }

  // Called once the dashboard is actually visible (initUser()) and again
  // whenever beforeinstallprompt fires (it can arrive after that first
  // call). Every DOM lookup is independently null-guarded — this must
  // never be able to throw and take the dashboard down with it, matching
  // renderPanchang()/renderHeader()'s established pattern.
  _updateInstallBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (!banner) return;

    if (this._isStandaloneDisplay() || !this._isLikelyPhone() || this.currentRole !== 'user') {
      banner.classList.add('hidden');
      return;
    }

    const dismissedAt = parseInt(localStorage.getItem('myniyam_installBannerDismissedAt') || '0', 10);
    if (dismissedAt && (Date.now() - dismissedAt) < 14 * 24 * 60 * 60 * 1000) {
      banner.classList.add('hidden');
      return;
    }

    const installBtn = document.getElementById('btn-pwa-install');
    const subtext = document.getElementById('pwa-install-subtext');
    if (this._deferredInstallPrompt) {
      if (installBtn) installBtn.classList.remove('hidden');
      if (subtext) subtext.textContent = 'Add to your home screen for quick access';
    } else if (this._isIOSDevice()) {
      if (installBtn) installBtn.classList.add('hidden');
      if (subtext) subtext.textContent = 'Tap Share, then "Add to Home Screen"';
    } else {
      if (installBtn) installBtn.classList.add('hidden');
      if (subtext) subtext.textContent = 'Open your browser menu and tap "Add to Home Screen"';
    }
    banner.classList.remove('hidden');
  }

  // Binds the shared profile-switcher overlay's entry points and controls
  // once, here — same reasoning as _initLogoutConfirm() just above: the
  // overlay now serves BOTH the user header's avatar / Profile-tab button
  // AND the admin header's avatar, but only one of setupUserEventListeners()
  // / setupAdminEventListeners() ever runs per session, so neither is a
  // reliable home for something shared. A user session harmlessly binds the
  // admin header's button too — it lives inside #admin-panel.hidden
  // (display:none) for that session and can never be clicked.
  _initProfileSwitcher() {
    ['header-avatar-btn', 'btn-switch-profile', 'admin-header-avatar-btn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => this.openProfileSwitcher());
    });
    const closeBtn = document.getElementById('btn-close-profile-switcher');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeProfileSwitcher());
    const addBtn = document.getElementById('btn-add-profile');
    if (addBtn) addBtn.addEventListener('click', () => this.addProfile());
  }

  // ===== ANDROID BACK BUTTON / BROWSER HISTORY =====
  // Makes the phone's back button (and Escape, for free) close the topmost
  // open overlay, and once nothing is open, step back through the bottom-nav
  // tabs before finally leaving the app. See OVERLAY_CLOSERS above for the
  // full list this covers.
  //
  // Deliberately watches the DOM instead of editing any of the 11 existing
  // open*/close* pairs: a MutationObserver on each .overlay's `class`
  // attribute is the single place that decides "did an overlay just open or
  // close", so every overlay — including any added later — is covered
  // automatically and none of their current logic is touched.
  //
  // The one thing this design has to get right is that history.back() is
  // ASYNCHRONOUS — its popstate arrives later, not in the same call stack.
  // _navHandlingPop is what keeps the two directions from fighting each
  // other:
  //   - Back press: _navOnPopState() sets the flag, closes the overlay
  //     (mutating its class), then clears the flag on a setTimeout(0) —
  //     after the MutationObserver's own microtask has already run and seen
  //     the flag still set, so it knows this close's history entry was
  //     already consumed by the pop and does NOT call history.back() again.
  //   - ✕ / Cancel / programmatic close: the flag is clear when the
  //     MutationObserver sees it, so it calls history.back() itself to
  //     consume the entry that opening the overlay had pushed — keeping
  //     history and the UI in step either way.
  _initNavHistory() {
    const overlayEls = document.querySelectorAll('.overlay');
    if (overlayEls.length === 0) return;

    const observer = new MutationObserver(mutations => {
      mutations.forEach(m => this._navHandleOverlayMutation(m.target));
    });
    overlayEls.forEach(el => {
      if (el.id) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    this._overlayObserver = observer;

    window.addEventListener('popstate', e => this._navOnPopState(e));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._navCloseTopOverlay();
    });
  }

  // The single MutationObserver callback — decides whether an overlay just
  // opened or closed by diffing against _openOverlayStack (not by re-reading
  // the class list, which by now only reflects the NEW state).
  _navHandleOverlayMutation(el) {
    const id = el && el.id;
    if (!id) return;
    const isOpen = el.classList.contains('show');
    const stackIdx = this._openOverlayStack.indexOf(id);
    const wasOpen = stackIdx !== -1;
    if (isOpen === wasOpen) return; // no real open/close transition (e.g. an unrelated class toggled)

    if (isOpen) {
      this._openOverlayStack.push(id);
      if (!this._navHandlingPop) {
        history.pushState({ tab: this._navCurrentTab(), overlay: id }, '');
      }
    } else {
      this._openOverlayStack.splice(stackIdx, 1);
      if (!this._navHandlingPop) {
        // Consumes the entry this overlay's open pushed, so a ✕/Cancel/
        // programmatic close leaves history exactly where a real back press
        // would have. Never fires from inside _navOnPopState() itself
        // (_navHandlingPop is true there), which is what stops this from
        // recursing into another pop.
        history.back();
      }
    }
  }

  // The sole popstate handler: close the topmost overlay if one is open;
  // otherwise, if the admin is mid-drill-down into a specific user, back
  // out to the Leaderboard; otherwise step to whichever tab the entry we
  // just landed on names.
  _navOnPopState(e) {
    this._navHandlingPop = true;
    try {
      if (this._openOverlayStack.length > 0) {
        const topId = this._openOverlayStack[this._openOverlayStack.length - 1];
        this._navCloseOverlayById(topId);
      } else if (!this.currentRole) {
        // Signed out (logout() always nulls this) — a stray popstate can
        // still arrive after logout() has already run (e.g. the logout-
        // confirm overlay's own close consumes its history entry
        // asynchronously, landing after the page has moved on). Neither of
        // the branches below have anything valid to act on once #app and
        // #admin-panel are both hidden, so this just stops here.
        return;
      } else if (this._adminSelectedUid) {
        // Tracked via our own JS state rather than anything in the popped
        // entry — mirrors the overlay stack above — because
        // _showAdminOverview() itself always decides the destination
        // (Leaderboard), so the entry's own `tab` value is irrelevant here.
        // Only ever set by selectAdminUser(), and cleared by every path
        // that leaves the individual view (this one, the "← Back" button,
        // a direct nav-bar tap elsewhere, or deleting the viewed user) —
        // see _resetAdminProgressView().
        this._showAdminOverview();
      } else {
        const tab = e.state && typeof e.state.tab === 'string' ? e.state.tab : null;
        if (tab) this._navSwitchToTab(tab);
      }
    } finally {
      // Cleared on the next macrotask — after the MutationObserver's
      // microtask (queued by the classList change _navCloseOverlayById()
      // just made) has already run and read the flag as still true.
      setTimeout(() => { this._navHandlingPop = false; }, 0);
    }
  }

  // Runs an overlay's real close method (so its own cleanup — clearing
  // _openDayDetailKey, chaining to the next badge, etc. — always happens),
  // falling back to a direct hide if the id isn't registered or its method
  // is missing, so back can never throw even for a future overlay someone
  // forgets to add to OVERLAY_CLOSERS.
  _navCloseOverlayById(id) {
    const methodName = OVERLAY_CLOSERS[id];
    const method = methodName ? this[methodName] : null;
    if (typeof method === 'function') {
      method.call(this);
    } else {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('show'); el.classList.add('hidden'); }
    }
  }

  // Escape's handler — same effect as clicking that overlay's own ✕, so it
  // goes through the ordinary (non-pop) close path and lets the
  // MutationObserver consume the history entry itself.
  _navCloseTopOverlay() {
    if (this._openOverlayStack.length === 0) return;
    this._navCloseOverlayById(this._openOverlayStack[this._openOverlayStack.length - 1]);
  }

  // Only ever called with a name already checked against USER_TABS/ADMIN_TABS
  // — still re-validated here (not just at the call site) so this can never
  // be the one place that regresses if it's ever called from somewhere else
  // later. switchTab()/switchAdminTab() have their own null guards besides.
  _navSwitchToTab(tab) {
    if (USER_TABS.includes(tab)) this.switchTab(tab);
    else if (ADMIN_TABS.includes(tab)) this.switchAdminTab(tab);
  }

  // Identifies the currently-visible tab so an overlay opened from it pushes
  // a history entry that returns here — mirrors the exact id scheme
  // switchTab()/switchAdminTab() already use (`tab-<name>` /
  // `admin-tab-<name minus its "admin-" prefix>`). Falls back to 'home' if
  // neither tab set has an .active element yet (e.g. an overlay somehow
  // opens before the dashboard has revealed).
  _navCurrentTab() {
    const userActive = document.querySelector('#app .tab-content.active');
    if (userActive && userActive.id.startsWith('tab-')) return userActive.id.slice(4);
    const adminActive = document.querySelector('.admin-tab-content.active');
    if (adminActive && adminActive.id.startsWith('admin-tab-')) {
      return 'admin-' + adminActive.id.slice('admin-tab-'.length);
    }
    return 'home';
  }

  // ===== LOADING SCREEN =====
  // Two entry points now show it: index.html's <head> script (pre-paint, for
  // a returning session) sets the class directly before any JS runs, and
  // showLoginScreen()'s sign-in handler calls this once Google auth succeeds.
  // Either way, arming the retry timer here (rather than only once in the
  // constructor) means a stalled Sheet lookup always gets a Retry button
  // ~10s later, however the loading screen was triggered.
  _showLoadingScreen() {
    document.documentElement.classList.add('booting-session');
    this._armLoadingRetryTimer();
  }

  // Removing this one class atomically hides #loading-screen AND lifts the
  // CSS override that was forcing #login-screen/#landing-screen hidden (see
  // styles.css's `html.booting-session` rules) — so there's never a gap
  // where none of the three are visible, no matter which of the 4 terminal
  // auth states (login, registration, dashboard, admin panel) triggers it.
  _hideLoadingScreen() {
    document.documentElement.classList.remove('booting-session');
    if (this._loadingRetryTimer) {
      clearTimeout(this._loadingRetryTimer);
      this._loadingRetryTimer = null;
    }
    const retryBtn = document.getElementById('btn-loading-retry');
    if (retryBtn) retryBtn.classList.add('hidden');
  }

  // (Re-)arms the ~10s Retry-button timer. Re-entrant: signing in again after
  // an earlier attempt (e.g. Cancel then retry) clears any timer already
  // ticking rather than stacking a second one.
  _armLoadingRetryTimer() {
    if (this._loadingRetryTimer) clearTimeout(this._loadingRetryTimer);
    this._loadingRetryTimer = setTimeout(() => {
      this._loadingRetryTimer = null;
      if (!document.documentElement.classList.contains('booting-session')) return;
      const retryBtn = document.getElementById('btn-loading-retry');
      if (retryBtn) retryBtn.classList.remove('hidden');
    }, 10000);
  }

  // Binds the Retry button's click handler once, and arms the timer for the
  // pre-paint boot case (a returning session already has `booting-session`
  // set by the time this constructor code runs). The post-sign-in case arms
  // its own timer via _showLoadingScreen() instead.
  _initLoadingScreenRetry() {
    const retryBtn = document.getElementById('btn-loading-retry');
    if (!retryBtn) return;

    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying…';
      try {
        await Auth.retryRoleCheck();
      } catch (e) {
        // _fetchRoleFromFirebase itself never throws, but the localStorage
        // write inside _resolveAndPublishUser can (quota exceeded, private
        // browsing, etc.) — caught here so the button can never get stuck
        // disabled forever on that edge case.
        console.error('Retry failed:', e);
      } finally {
        // A successful retry ends in one of the 4 terminal states, which
        // already hides the loading screen; if it's still up, nothing new
        // resolved, so restore the button for another try.
        retryBtn.disabled = false;
        retryBtn.textContent = 'Retry';
      }
    });

    if (document.documentElement.classList.contains('booting-session')) {
      this._armLoadingRetryTimer();
    }
  }

  // ===== LANDING PAGE =====
  // A pure overlay on top of the existing flow — position:fixed above
  // #login-screen, dismissed by simply hiding it. init()'s auth state
  // machine is never touched.
  //
  // Two ways to reach it, so setup is split in two:
  //  - A signed-out visitor's very first load sees it already un-hidden in
  //    the markup — _initLanding() (constructor time) sets it up then.
  //  - logout() re-opens it later for a session whose landing was hidden
  //    pre-paint (index.html's <head> script) and therefore never set up —
  //    showLanding() calls the same idempotent worker on demand.
  _initLanding() {
    const landingEl = document.getElementById('landing-screen');
    // Hidden pre-paint for a returning signed-in visitor. Nothing to set up
    // for a page nobody will see yet — and skipping this also means
    // Auth.fetchStats() never fires concurrently with the critical
    // google_login Sheets request on that path. logout() calls
    // _ensureLandingReady() directly if this page is ever needed later.
    if (!landingEl || landingEl.classList.contains('hidden')) return;
    this._ensureLandingReady();
  }

  // The actual one-time setup, split out of _initLanding() so logout() can
  // trigger it for a session that skipped it at construction. Guarded by
  // _landingReady so calling it again (e.g. a second logout) is a no-op.
  _ensureLandingReady() {
    if (this._landingReady) return;
    this._landingReady = true;

    document.querySelectorAll('.landing-cta').forEach(btn => {
      btn.addEventListener('click', () => this.dismissLanding());
    });

    this._createParticles('landing-particles'); // already double-population guarded
    this._renderLandingNiyamGrid();
    this._loadLandingStats();
    this._setupLandingScrollEffects();
  }

  dismissLanding() {
    const el = document.getElementById('landing-screen');
    if (el) el.classList.add('hidden');
    document.body.classList.remove('landing-open');
    // A session that reached the landing via showLanding() (post-logout) may
    // never have had showLoginScreen() run for it at construction time (it
    // booted straight past the login screen into the dashboard). Calling it
    // here guarantees the card underneath is always actually set up — it's
    // safely re-entrant (_createParticles() is double-population guarded,
    // and the sign-in button's handler is a plain `onclick` re-assignment).
    this.showLoginScreen();
  }

  // The mirror of dismissLanding() — reopens the landing page for a session
  // that already resolved past it once (used by logout()).
  showLanding() {
    const el = document.getElementById('landing-screen');
    if (!el) return;
    el.classList.remove('hidden');
    document.body.classList.add('landing-open');
    el.scrollTop = 0; // it scrolls internally; a prior visit may have left it mid-page
    // Driven by the hero IntersectionObserver, which only fires on scroll
    // changes — reset explicitly so a stale visible state isn't left over
    // from before.
    const sticky = document.getElementById('landing-sticky-cta');
    if (sticky) sticky.classList.remove('is-visible');
    // After un-hiding, so IntersectionObservers created inside register
    // against an element that's actually laid out and scrollable.
    this._ensureLandingReady();
  }

  // Populates the "What you can track" grid from NIYAM_STATS — the single
  // source of truth for the app's real niyam catalog — so the landing page
  // can never advertise a niyam the app doesn't actually have. Screen Time
  // (penalty: true) is excluded; it's a limit, not something to showcase.
  _renderLandingNiyamGrid() {
    const gridEl = document.getElementById('landing-niyam-grid');
    if (!gridEl) return;
    gridEl.innerHTML = NIYAM_STATS
      .filter(n => !n.penalty)
      .map(n => `
        <div class="landing-niyam-item">
          <span class="landing-niyam-icon">${n.icon}</span>
          <span class="landing-niyam-label">${n.label}</span>
        </div>
      `).join('');
  }

  // Paints from a localStorage cache instantly (any age — better than a
  // dash while the network call is in flight), then refreshes from
  // Auth.fetchStats() (never throws; null on any failure) and re-caches.
  // Only paints a dash — never NaN/undefined — when there is neither a
  // cache nor a successful fetch.
  async _loadLandingStats() {
    const usersEl = document.getElementById('landing-stat-users');
    const sanghsEl = document.getElementById('landing-stat-sanghs');
    if (!usersEl && !sanghsEl) return;

    const CACHE_KEY = 'myniyam_stats';
    let cached = null;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch (e) { /* corrupt/unavailable cache — ignore */ }

    if (cached && typeof cached.users === 'number' && typeof cached.sanghs === 'number') {
      this._landingStats = cached;
      // Paint immediately unless the stats band's own scroll observer has
      // already claimed the first paint (see _setupLandingScrollEffects()).
      if (!this._landingStatsAnimated) this._paintLandingStats(false);
    }

    const fresh = await Auth.fetchStats();
    if (fresh) {
      this._landingStats = fresh;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(fresh)); } catch (e) { /* storage full/unavailable — non-fatal */ }
      // If the scroll observer already animated once (or reduced-motion
      // already painted once), correct the number in place rather than
      // re-animating; otherwise leave it for the observer to animate in
      // when the visitor actually scrolls to it.
      if (this._landingStatsAnimated) this._paintLandingStats(false);
    } else if (!cached) {
      if (usersEl) usersEl.textContent = '—';
      if (sanghsEl) sanghsEl.textContent = '—';
    }
  }

  _paintLandingStats(animate) {
    const stats = this._landingStats;
    if (!stats) return;
    const usersEl = document.getElementById('landing-stat-users');
    const sanghsEl = document.getElementById('landing-stat-sanghs');
    if (usersEl) this._setLandingStatValue(usersEl, stats.users, animate);
    if (sanghsEl) this._setLandingStatValue(sanghsEl, stats.sanghs, animate);
  }

  _setLandingStatValue(el, value, animate) {
    const target = Math.max(0, Math.round(Number(value) || 0));
    if (animate) this._animateCount(el, target);
    else el.textContent = target.toLocaleString();
  }

  // requestAnimationFrame count-up from 0 to `target` with ease-out. Only
  // ever called when motion is allowed — see _setupLandingScrollEffects().
  _animateCount(el, target) {
    const duration = 1200;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = target.toLocaleString();
    };
    requestAnimationFrame(step);
  }

  // Scroll-driven behavior scoped to #landing-screen (which scrolls
  // internally, NOT the window — see #landing-screen's own
  // position:fixed/overflow-y:auto): reveals sections (and, via CSS alone,
  // their staggered child cards/steps/stats/niyam-items and the step rail)
  // as they enter view, shows the sticky CTA bar once the hero scrolls away,
  // triggers the stats count-up exactly once, and tracks live scroll
  // position for the progress bar + hero parallax. prefers-reduced-motion
  // (or a browser without IntersectionObserver) skips all of it and shows
  // every final state immediately — none of this is required to read or use
  // the page.
  _setupLandingScrollEffects() {
    const scrollRoot = document.getElementById('landing-screen');
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const revealEls = document.querySelectorAll('.landing-reveal');
    const stickyBar = document.getElementById('landing-sticky-cta');
    const heroEl = document.getElementById('landing-hero');
    const statsEl = document.getElementById('landing-stats-band');
    const progressBarEl = document.getElementById('landing-progress-bar');

    if (reduceMotion || typeof IntersectionObserver === 'undefined') {
      revealEls.forEach(el => el.classList.add('is-visible'));
      if (stickyBar) stickyBar.classList.add('is-visible');
      this._landingStatsAnimated = true;
      if (this._landingStats) this._paintLandingStats(false);
      // The progress bar and hero parallax are purely decorative scroll-
      // position trackers — under reduced motion (or an old browser with no
      // IntersectionObserver) they're simply never wired up; the
      // reduced-motion CSS block keeps both visually neutral either way.
      return;
    }

    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, root: scrollRoot });
    revealEls.forEach(el => revealObserver.observe(el));

    if (heroEl && stickyBar) {
      const heroObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          stickyBar.classList.toggle('is-visible', !entry.isIntersecting);
        });
      }, { threshold: 0, root: scrollRoot });
      heroObserver.observe(heroEl);
    }

    if (statsEl) {
      const statsObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !this._landingStatsAnimated) {
            this._landingStatsAnimated = true;
            if (this._landingStats) this._paintLandingStats(true);
            statsObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.4, root: scrollRoot });
      statsObserver.observe(statsEl);
    }

    // Progress bar + hero parallax track live scroll POSITION rather than a
    // one-shot "has this entered view yet", so they need an actual scroll
    // listener rather than an IntersectionObserver. rAF-throttled so a fast
    // scroll never queues more than one calculation per frame.
    if (progressBarEl || heroEl) {
      let ticking = false;
      const updateOnScroll = () => {
        ticking = false;
        const scrollTop = scrollRoot.scrollTop;
        if (progressBarEl) {
          const maxScroll = scrollRoot.scrollHeight - scrollRoot.clientHeight;
          const pct = maxScroll > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 0;
          progressBarEl.style.transform = `scaleX(${pct})`;
        }
        if (heroEl) {
          const heroHeight = heroEl.offsetHeight || 1;
          const heroProgress = Math.min(1, Math.max(0, scrollTop / heroHeight));
          heroEl.style.setProperty('--hero-progress', heroProgress);
        }
      };
      scrollRoot.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateOnScroll);
      }, { passive: true });
      updateOnScroll(); // paints the correct state immediately, e.g. on a re-show that reset scrollTop to 0
    }
  }

  // ===== INITIALIZATION =====
  async init() {
    Auth.init();
    Auth.onAuthStateChanged(async (user) => {
      if (user) {
        this.uid = user.uid;
        this.currentRole = user.role;
        this._currentAuthUser = user;

        if (user.role === 'admin') {
          // Admin skips registration
          if (!this._adminInitDone) {
            this._adminInitDone = true;
            db.ref(`users/${user.uid}/name`).set(user.name || user.uid).catch(e => console.warn('Failed to write admin name:', e));
            // No role mirroring here — role now comes FROM Firebase (see
            // auth.js's _fetchRoleFromFirebase), so writing it back would be
            // a pointless self-write, and firebase-rules.json deliberately
            // makes `role` non-client-writable (see its .validate rule) so
            // a user can never grant themselves admin.
            this.initAdmin();
          }
        } else {
          // user.registered is: true (registered), false (not registered),
          // or undefined (cached session — wait for the fresh Firebase
          // response; see _fetchRoleFromFirebase in auth.js).
          if (user.registered === undefined) {
            // Cached session — the fresh response hasn't arrived yet.
            // The loading screen is deliberately left showing here — see
            // initUser() / initAdmin() / showRegistrationForm(), which are
            // now the ONLY places that ever call _hideLoadingScreen(), each
            // doing so in the same breath as revealing their own screen.
            // That makes a blank gap between "loading gone" and "something
            // visible" structurally impossible, no matter how long any
            // awaited call takes.
            return;
          }
          if (user.registered) {
            if (!this._userInitDone) {
              this._userInitDone = true;
              this.initUser();
            }
          } else {
            this.showRegistrationForm(user);
          }
        }
      } else {
        this._userInitDone = false;
        this._adminInitDone = false;
        // `user` is null both for a genuinely signed-out visitor AND for a
        // returning session before Firebase's own onAuthStateChanged has
        // fired for the first time (auth.js registers this callback and
        // invokes it immediately with whatever currentUser already is,
        // which for a Firebase-only session — no cached myniyam_session —
        // is still null at that instant). Only wait in the latter case: a
        // brand-new visitor (booting-session never set) must still get
        // showLoginScreen() synchronously here, since _initLanding() (see
        // below) relies on it having already run by the time a landing tap
        // is possible.
        if (!Auth.isAuthResolved() &&
            document.documentElement.classList.contains('booting-session')) {
          return;
        }
        this.showLoginScreen();
      }
    });
  }

  showLoginScreen() {
    this._hideLoadingScreen();
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

        if (result.success) {
          // Google itself has authenticated them; the Sheet round-trip that
          // decides dashboard vs. registration is still in flight (handled
          // by init()'s auth listener from here). Guard on #login-screen
          // still being the visible screen: signInWithPopup resolving and
          // Firebase's onAuthStateChanged firing aren't ordered against each
          // other, so if a terminal state somehow already won that race and
          // hid #login-screen, showing the loading screen now would strand
          // it on top of the real destination instead of replacing this card.
          const loginEl = document.getElementById('login-screen');
          if (loginEl && !loginEl.classList.contains('hidden')) {
            this._showLoadingScreen();
          }
        } else {
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
    this._createParticles('login-particles');
  }

  // Shared by the login screen and the landing hero — same floating-particle
  // effect, different container id, guarded against double-population.
  _createParticles(containerId) {
    const container = document.getElementById(containerId);
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
    this._hideLoadingScreen();
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('register-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('app-hidden');
    document.getElementById('admin-panel').classList.add('hidden');

    // Pre-fill name from Google account. For an added (non-primary) profile
    // that hasn't registered yet, auth.js deliberately leaves user.name ''
    // rather than borrowing the Google account's (the parent's) display
    // name, so this naturally skips prefilling in that case.
    const nameInput = document.getElementById('reg-name');
    if (nameInput && user.name) nameInput.value = user.name;

    // "Cancel" only makes sense when registering an ADDED profile reached
    // via "Add Profile" — there's somewhere to go back to. A brand-new
    // user's very first-ever registration has no previous profile to
    // revert to, so the button stays hidden there.
    const cancelBtn = document.getElementById('btn-cancel-registration');
    if (cancelBtn) {
      const isAddedProfile = !!(user.baseUid && user.uid !== user.baseUid);
      cancelBtn.classList.toggle('hidden', !isAddedProfile);
      cancelBtn.onclick = () => this.cancelAddProfile();
    }

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

    // Gender pills — delegated on the container (assigned via .onclick, not
    // addEventListener, so re-visiting this screen never double-binds) and
    // reset on every visit, mirroring the photo picker just above: an
    // abandoned "Add Profile" attempt must never carry a stale selection
    // into the next registration.
    const genderInput = document.getElementById('reg-gender');
    const genderPillsEl = document.getElementById('reg-gender-pills');
    if (genderInput) genderInput.value = '';
    if (genderPillsEl) {
      genderPillsEl.querySelectorAll('.gender-pill').forEach(p => p.classList.remove('is-selected'));
      genderPillsEl.onclick = (e) => {
        const pill = e.target.closest('.gender-pill');
        if (!pill) return;
        genderPillsEl.querySelectorAll('.gender-pill').forEach(p => p.classList.remove('is-selected'));
        pill.classList.add('is-selected');
        if (genderInput) genderInput.value = pill.dataset.value;
        const errorEl = document.getElementById('register-error');
        if (errorEl) errorEl.classList.add('hidden');
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
      // sanghs/ is the only source now (see Auth.fetchSanghs()) — an empty
      // result here means either sanghs/ hasn't been populated yet, its
      // shape is wrong, or the read was denied by firebase-rules.json.
      // fetchSanghs() itself already logged which of those three it was;
      // this just points a developer back at that message.
      console.error('Sangh list came back empty — see fetchSanghs()\'s own diagnostic logged just above for the specific cause.');
    }
    this._setupSanghAutocomplete();
  }

  // Search/filter/select behavior shared by the registration form's sangh
  // picker and the sangh re-selection overlay
  // (_promptSanghReselectIfOrphaned()) — same widget, two different sets of
  // DOM ids and "where does the choice go" targets, so the two can never
  // drift apart in behavior.
  //
  // opts (all optional):
  //   sanghs       the list to search — defaults to this._sanghsList
  //   ids          { input, dropdown, selectedDiv, hiddenInput } — default
  //                to the registration form's own ids, so the registration
  //                call site (_setupSanghAutocomplete() with no args) needs
  //                no changes at all
  //   setSelected  called with the chosen sangh object (or null once
  //                cleared) — defaults to setting this._selectedSangh, the
  //                field handleRegistration() reads. Selection state itself
  //                is tracked in a local closure variable below, never on
  //                `this` directly, so two instances of this widget open at
  //                once could never clobber each other's selection.
  //   closeOutsideSelector  container whose outside-click closes the
  //                dropdown — defaults to '.sangh-group' (registration's
  //                container); the overlay passes its own.
  _setupSanghAutocomplete(opts) {
    opts = opts || {};
    const sanghs = opts.sanghs || this._sanghsList || [];
    const ids = opts.ids || {};
    const input = document.getElementById(ids.input || 'reg-sangh');
    const dropdown = document.getElementById(ids.dropdown || 'sangh-dropdown');
    const selectedDiv = document.getElementById(ids.selectedDiv || 'sangh-selected');
    const hiddenInput = document.getElementById(ids.hiddenInput || 'reg-sangh-code');
    const setSelected = opts.setSelected || ((sangh) => { this._selectedSangh = sangh; });
    if (!input || !dropdown || !selectedDiv || !hiddenInput) return;

    let selected = null;

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
      selected = sangh;
      setSelected(sangh);
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
        selected = null;
        setSelected(null);
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
      if (!selected) {
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
    const closeOutsideSelector = opts.closeOutsideSelector || '.sangh-group';
    document.addEventListener('click', (e) => {
      if (!e.target.closest(closeOutsideSelector)) {
        dropdown.classList.add('hidden');
      }
    });
  }

  async handleRegistration() {
    const name = document.getElementById('reg-name').value.trim();
    const dob = document.getElementById('reg-dob').value;
    const gender = document.getElementById('reg-gender').value;
    const phone = document.getElementById('reg-phone').value.trim();
    const city = document.getElementById('reg-city').value.trim();
    const area = document.getElementById('reg-area').value.trim();
    const rollNo = document.getElementById('reg-rollno').value.trim();
    const sanghCode = document.getElementById('reg-sangh-code').value.trim();
    const errorEl = document.getElementById('register-error');
    const btn = document.getElementById('btn-register');

    if (!name || !dob || !gender || !phone || !city || !area) {
      errorEl.textContent = 'Please fill all fields.';
      errorEl.classList.remove('hidden');
      return;
    }

    // v4's data had DOBs like "111111-11-11" and "10101-01-01" — real
    // registrations that somehow bypassed <input type="date">'s own
    // constraints (a browser quirk, or a value set some other way). Belt
    // and suspenders: reject anything outside a sane human lifespan,
    // client-side, in addition to the input's own min="1920-01-01".
    const dobDate = new Date(`${dob}T00:00:00`);
    const dobYear = dobDate.getFullYear();
    const todayForDob = new Date();
    if (isNaN(dobDate.getTime()) || dobYear < 1920 || dobDate > todayForDob) {
      errorEl.textContent = 'Please enter a valid date of birth.';
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

    // Optional — only validated when the user actually typed something.
    // Digits only, capped at 6 (a pasted phone number is 10).
    if (rollNo && !/^[0-9]{1,6}$/.test(rollNo)) {
      errorEl.textContent = 'Roll No. must be numbers only (up to 6 digits).';
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

    const user = this._currentAuthUser;

    try {
      const photoDataUrl = this._registrationPhotoDataUrl;
      const regData = {
        name, dob, gender, phone, city, area, rollNo, sanghCode,
        sanghName: this._selectedSangh.name,
        sanghCity: this._selectedSangh.city,
        photo: photoDataUrl
      };

      // Save to Firebase — this IS registration; nothing else has to
      // succeed for the user to be registered. The photo goes to its own
      // sibling path (users/{uid}/photo), NOT inside `registration` —
      // that node is read on every login (_tryFetchIdentityFromFirebase
      // in auth.js) and must stay small.
      const { photo, ...regDataForFirebase } = regData;
      await db.ref(`users/${this.uid}`).update({
        name: name,
        role: 'user',
        registered: true,
        registration: regDataForFirebase,
        registeredAt: new Date().toISOString(),
        photo: photoDataUrl
      });

      // Link user to their sangh for admin discovery — sangh_members is a
      // derived index; registration.sanghCode (just written above) stays
      // the single source of truth for which sangh a member belongs to.
      if (sanghCode) {
        await db.ref(`sangh_members/${sanghCode}/${this.uid}`).set({
          joinedAt: new Date().toISOString()
        });
      }

      // Sheet write, in the background — purely to keep your Sheet current
      // for your own reference. Registration already succeeded via Firebase
      // above, so nothing here can slow down or block reaching the
      // dashboard, and sendRegistration() already never throws (it catches
      // and logs internally), so there's nothing to .catch() here either.
      Auth.sendRegistration(this.uid, user.email, regData);

      // Cache the just-saved photo locally so the Profile tab shows it
      // instantly, and mark the one-time photo prompt as already
      // satisfied — a freshly registered user must never see "please add a
      // photo" again.
      try {
        localStorage.setItem(`myniyam_photo_${this.uid}`, photoDataUrl);
        localStorage.setItem(`myniyam_photo_prompted_${this.uid}`, '1');
      } catch (e) { /* localStorage unavailable — non-fatal */ }

      // Hide registration, proceed to user app
      document.getElementById('register-screen').classList.add('hidden');
      this.initUser();
    } catch (err) {
      console.error('Registration failed:', err);
      // Show the specific reason when there is one (see the photo-upload
      // gate above, which throws a plain-language message) — a bare
      // "Failed to save" hides whether the problem is the photo, the
      // database rules, or the connection, none of which the user can
      // otherwise tell apart.
      errorEl.textContent = (err && err.message) || 'Failed to save. Please try again.';
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.querySelector('span').textContent = '🙏 Join Kalyan Mitra';
    }
  }

  // Persistent, non-fatal warning shown when one or more realtime listeners
  // failed to ever fire (denied Firebase rules, unreachable database, etc.)
  // — the screen is still revealed either way; this just tells the visitor
  // their data may not be syncing rather than failing silently.
  _showDbErrorBanner(failedPaths) {
    if (!failedPaths || failedPaths.length === 0) return;
    console.error('Realtime sync failed for:', failedPaths);
    const banner = document.getElementById('db-error-banner');
    if (banner) {
      banner.textContent = "⚠️ Can't reach the database — your niyams may not save right now. Please contact your sangh admin.";
      banner.classList.remove('hidden');
    }
  }

  // ===== USER INITIALIZATION =====
  async initUser() {
    this.initializing = true;
    const failedPaths = await this.setupRealtimeSync();
    this.initializing = false;

    // Safety net for any listener that never fired (see listenToRef()'s
    // error handling) — every render call below needs a real object to
    // work with, whether or not that specific listener succeeded. Only
    // fills in what's still unset, so listeners that DID succeed keep
    // their real data.
    this.settings = this.settings || { ...DEFAULT_SETTINGS };
    this.profile = this.profile || { ...DEFAULT_PROFILE };
    this.dailyLog = this.dailyLog || { ...DEFAULT_DAILY_LOG, date: this.getTodayKey() };

    // Reveal the dashboard unconditionally — even a partially-populated one
    // is vastly better than a blank page. This is also the only place
    // #login-screen is hidden on this path (see init()'s callback), so a
    // gap between "login gone" and "dashboard visible" can't open up no
    // matter how long any of the above awaited.
    this._hideLoadingScreen();
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('app-hidden');
    document.getElementById('app').classList.add('app-visible');
    document.getElementById('admin-panel').classList.add('hidden');
    // Establishes the root history entry (see _initNavHistory()) — the
    // dashboard's default tab, matching the "active" class index.html
    // already ships tab-home with. Back from here leaves the app, exactly
    // like today, rather than being trapped inside history navigation.
    history.replaceState({ tab: 'home', overlay: null }, '');
    this._showDbErrorBanner(failedPaths);

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

    // Registry card shells (data.js's NIYAM_REGISTRY) must exist in the DOM
    // BEFORE setupUserEventListeners() runs, or their buttons would have
    // nothing to bind to — mirroring how the built-in cards are already
    // static markup by the time listeners bind. Wrapped separately (rather
    // than relying on the try/catch below) because it runs before listener
    // binding: a throw here must never be allowed to also take
    // setupUserEventListeners() down with it.
    try {
      this._renderRegistryCards();
    } catch (e) {
      console.error('Registry niyam card rendering failed (dashboard stays interactive):', e);
    }

    // Interactive setup first — never gated on a render succeeding.
    // setupUserEventListeners() only touches static markup that exists from
    // page load and is already individually null-guarded, and
    // startAutoLockCheck() just registers an interval — neither depends on
    // any render having run.
    this.setupUserEventListeners();
    this.startAutoLockCheck();

    // Rendering is best-effort from here: one failure (e.g. a stray null
    // reference) must never take the rest of the dashboard — or the
    // listeners just bound above — down with it.
    try {
      this.renderDashboard();
      this.renderAchievements();
      this.checkStreakWarning();
      this.renderUserHeaderBrand();
    } catch (e) {
      console.error('Dashboard render failed (UI stays interactive):', e);
    }
    // Not awaited: a one-time check (guarded by localStorage) for
    // already-registered users with no profile photo yet.
    this._maybePromptForPhoto();
    // Not awaited: paints the header avatar from cache immediately (inside
    // the function itself) and reconciles the profile-switcher list in the
    // background — never blocks the dashboard on a Sheet round-trip.
    this._loadHeaderAvatar();
    this._loadAccountProfiles();
    // Dashboard is now visible and this.currentRole is 'user' — the one
    // point _updateInstallBanner()'s role check can actually pass. Wrapped
    // separately so a throw here can never take any of the above down.
    try {
      this._updateInstallBanner();
    } catch (e) {
      console.error('Install banner update failed (non-fatal):', e);
    }
    // Not awaited: nothing else in initUser() depends on it, and it must
    // never delay the dashboard becoming visible (already done above).
    // .catch() rather than a try/catch wrapper — this call is async and
    // un-awaited, so only .catch() can actually observe a later rejection
    // (see calculatePanchang()'s own history of this exact bug class:
    // an un-awaited async throw is a silent unhandled rejection unless
    // something is actually attached to catch it).
    this._promptSanghReselectIfOrphaned().catch(e => console.error('Sangh re-selection check failed (non-fatal):', e));
  }

  // Detects a member whose registered sangh has been removed via the
  // Firebase Console (see SANGH-RUNBOOK.md — sanghs/ is deliberately
  // console-only, no client can write it) and prompts them to pick a new
  // one, rather than silently continuing to log niyams no admin can see —
  // the leaderboard, attendance list and every export are all scoped by
  // _adminSanghCodes, which will never include a deleted code again.
  //
  // Deliberately fail-SAFE at every step: a network hiccup, an undeployed
  // sanghs/ node, or fetchSanghs() coming back empty must NEVER mass-prompt
  // every member — the only way this shows anything is a POSITIVE
  // confirmation, from the full sangh list (which includes the Sheet
  // fallback fetchSanghs() already has), that the code is truly gone.
  async _promptSanghReselectIfOrphaned() {
    if (this.currentRole !== 'user') return;

    const regSnap = await db.ref(`users/${this.uid}/registration`).once('value');
    const registration = regSnap.val();
    const code = registration && registration.sanghCode;
    if (!code) return; // unregistered — registration itself already requires picking a sangh

    // Cheap existence check first — one tiny read, not the whole list.
    // This is the common (healthy) path and costs almost nothing.
    const existsSnap = await db.ref(`sanghs/${code}`).once('value');
    if (existsSnap.exists()) return;

    // Only reached when sanghs/{code} is missing — confirm against the
    // FULL list before concluding it's truly gone, rather than trusting a
    // single node read that could itself be transient.
    let sanghsList = [];
    try {
      sanghsList = await Auth.fetchSanghs();
    } catch (e) {
      console.warn('Could not verify the sangh list — skipping re-selection this session:', e);
      return;
    }
    if (sanghsList.length === 0) return; // can't verify — never prompt on unresolvable data
    if (sanghsList.some(s => s.code === code)) return; // the Sheet fallback still knows it

    this._orphanedSanghCode = code;
    this._showSanghReselectOverlay(sanghsList);
  }

  // Populates and reveals the re-selection overlay, reusing
  // _setupSanghAutocomplete()'s search/filter/select widget with the
  // overlay's own ids and its own "where does the choice go" target
  // (this._orphanedSanghReselected, kept separate from registration's own
  // this._selectedSangh so the two flows can never clobber each other).
  _showSanghReselectOverlay(sanghsList) {
    const overlay = document.getElementById('sangh-reselect-overlay');
    if (!overlay) return;

    this._orphanedSanghReselected = null;
    const errorEl = document.getElementById('sangh-reselect-error');
    if (errorEl) errorEl.classList.add('hidden');

    this._setupSanghAutocomplete({
      sanghs: sanghsList,
      ids: {
        input: 'sangh-reselect-input',
        dropdown: 'sangh-reselect-dropdown',
        selectedDiv: 'sangh-reselect-selected',
        hiddenInput: 'sangh-reselect-code',
      },
      setSelected: (sangh) => { this._orphanedSanghReselected = sangh; },
      closeOutsideSelector: '.sangh-reselect-group',
    });

    const btn = document.getElementById('btn-sangh-reselect-confirm');
    if (btn) btn.onclick = () => this._confirmSanghReselect();

    overlay.classList.remove('hidden');
    overlay.classList.add('show');
  }

  // Writes the new sangh using only paths a member is already permitted to
  // write directly under firebase-rules.json (users/$uid and
  // sangh_members/$code/$uid, both scoped to auth.uid === $uid or one of
  // their own __pN slots), clears the stale sangh_members index entry for
  // the old (now-deleted) code, then reloads — the same approach
  // resetProgress() already uses — so every sangh-scoped listener
  // (settings, point map, attendance) re-attaches against the new code
  // from a clean start rather than needing to be surgically re-pointed
  // while live.
  async _confirmSanghReselect() {
    const errorEl = document.getElementById('sangh-reselect-error');
    const btn = document.getElementById('btn-sangh-reselect-confirm');
    const sangh = this._orphanedSanghReselected;
    if (!sangh) {
      if (errorEl) { errorEl.textContent = 'Please select a Sangh from the dropdown.'; errorEl.classList.remove('hidden'); }
      return;
    }

    const oldCode = this._orphanedSanghCode;
    if (errorEl) errorEl.classList.add('hidden');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    try {
      await db.ref(`users/${this.uid}/registration`).update({
        sanghCode: sangh.code,
        sanghName: sangh.name,
      });
      await db.ref(`sangh_members/${sangh.code}/${this.uid}`).set({
        joinedAt: new Date().toISOString()
      });
      if (oldCode && oldCode !== sangh.code) {
        await db.ref(`sangh_members/${oldCode}/${this.uid}`).remove();
      }
      location.reload();
    } catch (e) {
      console.error('Failed to save the new sangh:', e);
      if (errorEl) { errorEl.textContent = 'Failed to save. Please check your connection and try again.'; errorEl.classList.remove('hidden'); }
      if (btn) { btn.disabled = false; btn.textContent = 'Continue'; }
    }
  }

  // Recomputes every day's kpEarned from RAW_POINT_RULES (the same rules the
  // live award path and the Excel export use, evaluated against THIS
  // session's livePoints() — see computeRawDayPoints()) and sums them into
  // a fresh profile.totalKP. Originally a one-time migration off the old
  // streak-multiplier/bonus scoring (guarded by the plain boolean
  // rawPointsMigrated); now doubles as the lazy self-heal for a per-sangh
  // niyam-points change, via profile.pointsVersion vs. this session's
  // this._sanghPointsVersion (set by setupRealtimeSync()'s sangh_config
  // listener, which resolves before this is ever called — see initUser()).
  // Catches anyone an admin's own fan-out (_recomputeSanghPoints()) missed:
  // offline at save time, a member outside _adminUserUids, a partial write.
  // On failure the guard fields are deliberately left unset/stale so the
  // next login retries rather than silently staying un-migrated.
  //
  // Idempotent by construction either way: every run recomputes from the
  // same source daily_logs, so running it twice (a retry, or two logins in
  // a row before a version bump) always converges on the same total rather
  // than compounding.
  async _migrateToRawPoints() {
    const targetVersion = this._sanghPointsVersion || 0;
    if (this.profile.rawPointsMigrated && (this.profile.pointsVersion || 0) >= targetVersion) return;
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

      // Clamped — a member whose penalties now exceed their earnings must
      // read 0, never negative. The live award path (deductKarmaPoints())
      // already floors at 0; a recompute must agree.
      this.profile.totalKP = Math.max(0, total);
      this.profile.rawPointsMigrated = true;
      this.profile.pointsVersion = targetVersion;
      await this.saveProfile();
    } catch (e) {
      console.warn('Raw-points migration failed — will retry on next load.', e);
    }
  }

  // Resolves each sangh code to "Name (CODE)". sanghs/ (via
  // Auth.fetchSanghs(), memoized per session — one real read regardless of
  // how many labels this resolves across the app) is authoritative: its
  // name wins even when `knownNames` (the denormalized
  // registration.sanghName copied at signup) has a value, so a sangh
  // renamed in the database shows its NEW name instead of sticking on
  // whatever was true when the member registered. `knownNames` is only the
  // fallback — used when the code isn't in sanghs/ at all (a removed
  // sangh), where the stored name is the best label left.
  // `bare: true` drops the "(CODE)" suffix — used by the poster, where a
  // raw sangh code reads as a rendering glitch rather than useful context.
  async _resolveSanghLabels(codes, knownNames = {}, bare = false) {
    if (!codes || codes.length === 0) return [];

    let sanghsList = [];
    try {
      sanghsList = await Auth.fetchSanghs();
    } catch (e) {
      console.warn('Failed to fetch sanghs list:', e);
    }

    return codes.map(code => {
      const dbName = (sanghsList.find(s => s.code === code) || {}).name;
      const name = dbName || knownNames[code];
      if (bare) return name || code;
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

  // ===== MULTI-PROFILE (multiple members under one Google account) =====

  // The profile id this SESSION *is*. Deliberately not this.uid: on the
  // admin panel that field is the admin's current view TARGET — null on the
  // Leaderboard overview (_clearAdminSelection()) and the managed member's
  // uid while drilled into one (selectAdminUser()) — so keying any
  // multi-profile logic off it would make ordinary admin-panel uid churn
  // look like "the active profile vanished". _currentAuthUser.uid is written
  // once, in init()'s auth listener, and never moves. Falls back to this.uid
  // only for a session shape that predates _currentAuthUser existing.
  _activeProfileId() {
    const u = this._currentAuthUser;
    return (u && u.uid) || this.uid || null;
  }

  // Escapes a value for safe interpolation into an innerHTML template
  // literal. Needed here specifically because the profile switcher and (new)
  // admin profile-details card render fields a user can set themselves
  // (name, sanghCode, phone, city, area, photo src) straight from a
  // self-writable Firebase record — unlike the rest of this file's
  // template-literal renders, which only ever interpolate server-computed or
  // admin-only values.
  _escHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  // Loads the list of profiles under this Google account — paints instantly
  // from the cached index (account_profiles/{baseUid}), then reconciles
  // against Auth.fetchProfiles() (each slot's users/{id}/registration,
  // the real source) and re-mirrors the confirmed result back into that
  // cache. Both steps read Firebase; the cache read just saves the small
  // extra latency of the up-to-5-slot fan-out below it.
  //
  // Also self-heals a stale active profile: if the profile this session is
  // showing no longer exists (its registration was removed, or an "Add
  // Profile" attempt was abandoned before ever registering), falls back to
  // the primary and reloads once — the same "reload on switch" guarantee as
  // switchProfile(), so nothing here has to reconcile in-flight listeners
  // or caches for the wrong identity.
  async _loadAccountProfiles() {
    const baseUid = this._currentAuthUser && this._currentAuthUser.baseUid;
    if (!baseUid) return; // pre-multi-profile session shape — nothing to load

    try {
      const snap = await db.ref(`account_profiles/${baseUid}`).once('value');
      const cached = snap.val();
      if (cached && typeof cached === 'object') {
        this._accountProfiles = Object.values(cached);
      }
    } catch (e) {
      console.warn('Failed to load cached account profiles:', e);
    }

    const fresh = await Auth.fetchProfiles(baseUid); // never throws; null on any failure

    if (!fresh) {
      // Inconclusive — keep whatever was cached (or nothing), and do NOT
      // mirror to Firebase or run the stillExists self-heal below. Treating
      // a failed request as authoritative is exactly what silently bounced
      // a newly added, not-yet-registered profile back to the primary
      // before this fix: a failure used to look identical to "this account
      // has just one profile".
      console.warn('Could not confirm the account profile list from the Sheet — keeping the cached list.');
      return;
    }

    this._accountProfiles = fresh;

    // Mirror back to Firebase, keyed by profileId. Firebase keys can't
    // contain '.', '#', '$', '[', ']', '/' — profile ids never do, since
    // they're either a Firebase-Auth uid or that uid + '__pN'.
    try {
      const byId = {};
      fresh.forEach(p => { byId[p.profileId] = p; });
      await db.ref(`account_profiles/${baseUid}`).set(byId);
    } catch (e) {
      console.warn('Failed to mirror account profiles to Firebase:', e);
    }

    const activeId = this._activeProfileId();
    const stillExists = fresh.some(p => p.profileId === activeId);
    // The `activeId !== baseUid` half is what makes an infinite reload
    // structurally impossible rather than merely unlikely: the fallback
    // below moves the session TO the primary, so if the primary is where we
    // already are, a reload could only ever land in the exact state it just
    // left. Whatever reason `fresh` had for not listing us, looping on it is
    // never the answer — staying put with a console error is.
    if (!stillExists && activeId && activeId !== baseUid) {
      console.warn(`Active profile "${activeId}" no longer exists — falling back to primary.`);
      Auth.setActiveProfile(baseUid, baseUid);
      location.reload();
    } else if (!stillExists) {
      console.error(`Primary profile "${activeId}" is missing from its own profile list — staying put rather than reloading into the same state.`);
    }
  }

  // Renders the switcher's profile list from this._accountProfiles — paints
  // with cached photos immediately, then upgrades each from Auth.fetchPhoto()
  // in the background (mirrors _loadAvatarInto()'s cache-then-fetch shape,
  // just for N profiles instead of one).
  _renderProfileSwitcher() {
    const listEl = document.getElementById('profile-switcher-list');
    const addBtn = document.getElementById('btn-add-profile');
    if (!listEl) return;

    const profiles = this._accountProfiles || [];
    if (profiles.length === 0) {
      listEl.innerHTML = '<div class="profile-switcher-loading">Loading profiles…</div>';
      if (addBtn) addBtn.classList.add('hidden');
      return;
    }

    const activeId = this._activeProfileId();
    listEl.innerHTML = profiles.map(p => {
      let cachedPhoto = null;
      try { cachedPhoto = localStorage.getItem(`myniyam_photo_${p.profileId}`); } catch (e) { /* ignore */ }
      const initial = (p.name || '?').trim().charAt(0).toUpperCase() || '?';
      const isActive = p.profileId === activeId;
      const label = p.name || (p.isAdmin ? 'Admin' : (p.registered ? p.profileId : 'New Profile'));
      // An admin slot has no registration and therefore no sanghCode, so the
      // plain fallback would label the account owner's own row "Not
      // registered yet" — both wrong and alarming. An admin who ALSO
      // registered as a member keeps their sangh alongside the tag.
      const subLabel = p.isAdmin
        ? (p.sanghCode ? `👑 Admin · ${this._escHtml(p.sanghCode)}` : '👑 Admin')
        : this._escHtml(p.sanghCode || (p.registered ? '' : 'Not registered yet'));
      return `
        <div class="profile-switcher-item${isActive ? ' is-active' : ''}" data-profile-id="${this._escHtml(p.profileId)}">
          <div class="profile-switcher-avatar">
            ${cachedPhoto ? `<img src="${cachedPhoto}" alt="">` : `<span class="profile-switcher-initial">${this._escHtml(initial)}</span>`}
          </div>
          <div class="profile-switcher-info">
            <span class="profile-switcher-name">${this._escHtml(label)}</span>
            <span class="profile-switcher-sangh">${subLabel}</span>
          </div>
          ${isActive ? '<span class="profile-switcher-active-badge">✓ Active</span>' : ''}
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.profile-switcher-item').forEach(item => {
      item.addEventListener('click', () => this.switchProfile(item.dataset.profileId));
    });

    if (addBtn) addBtn.classList.toggle('hidden', profiles.length >= Auth.MAX_PROFILES);

    // Lazily fetch+correct each profile's photo — never blocks the initial
    // render, and a failure for one profile can't affect the others.
    profiles.forEach(p => {
      Auth.fetchPhoto(p.profileId).then(photo => { // never throws; null on any failure or "no photo"
        if (!photo) return;
        try { localStorage.setItem(`myniyam_photo_${p.profileId}`, photo); } catch (e) { /* non-fatal */ }
        const avatarWrap = listEl.querySelector(`.profile-switcher-item[data-profile-id="${p.profileId}"] .profile-switcher-avatar`);
        if (avatarWrap) avatarWrap.innerHTML = `<img src="${photo}" alt="">`;
      });
    });
  }

  openProfileSwitcher() {
    const overlay = document.getElementById('profile-switcher-overlay');
    if (!overlay) return;
    this._renderProfileSwitcher(); // instant paint from whatever's cached
    overlay.classList.remove('hidden');
    overlay.classList.add('show');
    // Reconciles against Firebase in the background and re-renders if the
    // list changed. Also self-heals (falls back + reloads) if the active
    // profile vanished — see _loadAccountProfiles().
    this._loadAccountProfiles().then(() => this._renderProfileSwitcher());
  }

  closeProfileSwitcher() {
    const overlay = document.getElementById('profile-switcher-overlay');
    if (overlay) { overlay.classList.remove('show'); overlay.classList.add('hidden'); }
  }

  // Reload is deliberate (see the plan's "reload on switch" decision) —
  // every Firebase listener, cache and init-guard in this app is scoped to
  // one profile id, so a reload guarantees a clean slate rather than
  // requiring a live teardown/re-init of all of it.
  switchProfile(profileId) {
    const baseUid = this._currentAuthUser && this._currentAuthUser.baseUid;
    if (!baseUid || !profileId) return;
    if (profileId === this._activeProfileId()) { this.closeProfileSwitcher(); return; } // already active
    Auth.setActiveProfile(baseUid, profileId);
    location.reload();
  }

  // Assigns the lowest free profile slot and reloads into it. That profile
  // has no Sheet row yet, so the normal auth flow naturally lands on
  // showRegistrationForm() — no separate registration path needed.
  addProfile() {
    const baseUid = this._currentAuthUser && this._currentAuthUser.baseUid;
    if (!baseUid) return;
    const nextId = Auth.getNextProfileId(baseUid, this._accountProfiles || []);
    // A no-op that reloads is indistinguishable from a broken button. The
    // second half is only reachable from a cached account_profiles list that
    // predates the active profile appearing in it — openProfileSwitcher()'s
    // background reconcile fixes that within a beat, so refusing to act here
    // is strictly better than reloading into the exact same screen.
    if (!nextId || nextId === this._activeProfileId()) return;
    Auth.setActiveProfile(baseUid, nextId);
    location.reload();
  }

  // Bound to the registration screen's Cancel button (only shown when
  // registering an ADDED profile — see showRegistrationForm()). Reverts to
  // the primary profile and reloads, so a mistaken "Add Profile" tap is
  // never a dead end.
  cancelAddProfile() {
    const baseUid = this._currentAuthUser && this._currentAuthUser.baseUid;
    if (baseUid) Auth.setActiveProfile(baseUid, baseUid);
    location.reload();
  }

  async fetchGeolocationAndPanchang() {
    // Load this user's OWN saved location — a per-user node, never a shared
    // one. Writing GPS coordinates anywhere global would broadcast one
    // user's precise location to every connected client and
    // re-trigger everyone's panchang calculation on every save.
    try {
      const snap = await db.ref(`users/${this.uid}/location`).once('value');
      this.location = snap.val() ? { ...DEFAULT_LOCATION, ...snap.val() } : { ...DEFAULT_LOCATION };
    } catch (e) {
      console.warn('Failed to load saved location, using default:', e);
      this.location = { ...DEFAULT_LOCATION };
    }

    // Render immediately from whatever location we have — never wait on a
    // GPS prompt or the network to show a panchang card. Fire-and-forget is
    // deliberate (see calculatePanchang()'s own comment); the .catch() only
    // makes a future throw in there show up in the console instead of
    // silently vanishing as an unhandled rejection, which is exactly how
    // the tithi/timings bug went unnoticed.
    this.calculatePanchang().catch(e => console.error('Panchang render failed:', e));

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
      this.calculatePanchang().catch(e => console.error('Panchang render failed:', e)); // re-render with the refined coordinates
    } catch (e) {
      console.warn('Geolocation denied or timed out — using last known location.', e);
    }
  }

  // ===== ADMIN INITIALIZATION =====
  async initAdmin() {
    this.initializing = false;
    this.settings = { ...DEFAULT_SETTINGS };
    // A fresh admin session has no user selected yet. Without this,
    // this.uid stays at the admin's OWN uid (set on login), so any
    // lock/unlock/reset action taken before selecting a user would target
    // the admin's own record instead of doing nothing.
    this._clearAdminSelection();

    // Store admin's sangh codes from auth
    this._adminSanghCodes = this._currentAuthUser.sanghCodes || [];
    this._adminUserUids = []; // UIDs this admin manages
    this._adminSanghPoints = {}; // code -> raw stored sangh_config value (or null), kept fresh by the listeners started below
    // A stale `true` left over from a PREVIOUS admin session (this app
    // instance survives a logout/login cycle without a page reload) would
    // otherwise permanently block loadAdminSettingsUI() from ever painting
    // anything in this new session.
    this._adminSettingsDirty = false;
    this.renderAdminHeaderBrand();
    // Not awaited: paints the admin header avatar from cache immediately
    // (inside the function itself) and reconciles the profile-switcher list
    // in the background — mirrors initUser()'s _loadHeaderAvatar()/
    // _loadAccountProfiles() pair, so the switcher opens already populated
    // instead of showing "Loading profiles…" on first tap.
    this._loadAdminHeaderAvatar();
    this._loadAccountProfiles();

    // The only place #login-screen is hidden on this path (see init()'s
    // callback) — done in the same breath as revealing the admin panel so
    // there is never a gap where neither is visible.
    this._hideLoadingScreen();
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('admin-panel').classList.remove('hidden');
    document.getElementById('app').classList.add('app-hidden');
    document.getElementById('app').classList.remove('app-visible');
    // Covers a user->admin profile switch without a full reload — nothing
    // else would re-run _updateInstallBanner()'s currentRole check here.
    const pwaBannerAdmin = document.getElementById('pwa-install-banner');
    if (pwaBannerAdmin) pwaBannerAdmin.classList.add('hidden');
    // Establishes the root history entry (see _initNavHistory()) — matches
    // the "active" class index.html already ships admin-tab-leaderboard
    // with. Back from here leaves the app rather than being trapped.
    history.replaceState({ tab: 'admin-leaderboard', overlay: null }, '');

    // Setup Admin Event Listeners (Tabs, Logout, etc.)
    this.setupAdminEventListeners();

    // v5 has no legacy global `settings` fallback layer any more — every
    // sangh's config is seeded/saved with every flag explicit (see
    // resolveSettings(), now a two-layer merge: DEFAULT_SETTINGS overlaid
    // by this sangh's own sangh_config/{code}/settings).

    // One listener per managed sangh, caching the WHOLE raw sangh_config
    // node — points, pointsVersion AND settings (see resolveSettings()) —
    // so the points UI, the toggles, and every aggregate
    // (_adminSanghPointMap(), used by the export/poster) always reflect
    // the latest stored value. Cached RAW (not merged with defaults) so
    // resolveSettings()/_adminSanghPointMap()/_loadAdminPointInputs() can
    // each resolve it fresh on demand.
    this._adminSanghCodes.forEach(code => {
      db.ref(`sangh_config/${code}`).on('value', snap => {
        this._adminSanghPoints[code] = snap.val() || null;
        // Only repaints if the Settings tab is currently showing THIS
        // sangh — a background sangh's listener firing must never clobber
        // whatever sangh the admin has selected in the dropdown right now.
        // loadAdminSettingsUI() itself also guards against clobbering an
        // in-progress edit (see this._adminSettingsDirty).
        const sel = document.getElementById('admin-points-sangh');
        const activeCode = (sel && sel.value) || this._adminSanghCodes[0];
        if (activeCode === code) this.loadAdminSettingsUI();
      }, err => console.error(`Firebase read failed for "sangh_config/${code}":`, err));
    });

    // Fetch and render Leaderboard — also fetches this._adminUserUids from
    // sangh_members (see _fetchAdminUsers()).
    await this.renderAdminLeaderboard();
  }

  // Replaces v4's single db.ref('users').on('value') — a permanent live
  // subscription to EVERY user in the entire database, re-delivered in
  // full on every write by anyone, anywhere (see the v5 restructure plan's
  // "Context" section). This is scoped and one-shot instead:
  //   1. sangh_members/{code} for each sangh this admin manages — a tiny
  //      uid index, not a data dump.
  //   2. users/{uid} for each of those uids, in one parallel batch — each
  //      read individually authorized by firebase-rules.json (an admin may
  //      read users/$uid iff $uid's own registration.sanghCode names a
  //      sangh this admin's baseUid administers).
  // No live listener means the leaderboard no longer updates itself while
  // the tab sits open — switchAdminTab() already re-runs
  // renderAdminLeaderboard() every time the admin navigates to the tab,
  // and #btn-refresh-leaderboard (setupAdminEventListeners()) covers the
  // "I want it current right now" case without a tab switch.
  async _fetchAdminUsers() {
    const codes = this._adminSanghCodes || [];
    if (codes.length === 0) {
      this._adminUserUids = [];
      console.log('Admin has no sangh codes — no users to manage.');
      return {};
    }

    let uids = [];
    try {
      const memberSnaps = await Promise.all(codes.map(code => db.ref(`sangh_members/${code}`).once('value')));
      const uidSet = new Set();
      memberSnaps.forEach(snap => {
        const val = snap.val() || {};
        Object.keys(val).forEach(uid => uidSet.add(uid));
      });
      uids = [...uidSet];
      console.log('Admin sangh codes:', codes, '| Sangh members:', uids);
    } catch (e) {
      console.error('Failed to fetch sangh members:', e);
      uids = [];
    }
    this._adminUserUids = uids;
    if (uids.length === 0) return {};

    const userSnaps = await Promise.all(uids.map(uid =>
      db.ref(`users/${uid}`).once('value').catch(e => {
        // One member's read failing (e.g. a rules edge case, a mid-delete
        // race) must not blank the whole leaderboard for everyone else.
        console.warn(`Failed to read users/${uid}:`, e);
        return null;
      })
    ));
    const allUsers = {};
    uids.forEach((uid, i) => {
      const val = userSnaps[i] && userSnaps[i].val();
      if (val) allUsers[uid] = val;
    });
    return allUsers;
  }

  // Recomputes the public `stats` node (see firebase-rules.json — the one
  // path readable without auth) from the same full `users` snapshot the
  // leaderboard listener already downloaded, so this costs one small extra
  // read (the sangh count) rather than a second users/ download. Not
  // awaited by its caller and failures are only logged: this is upkeep for
  // the signed-out landing page's two counters, never something an admin
  // action should be blocked or alarmed by.
  async _updatePublicStats(allUsers) {
    try {
      let users = 0;
      Object.values(allUsers || {}).forEach(data => {
        if (data && data.role !== 'admin') users++;
      });
      const sanghsSnap = await db.ref('sanghs').once('value');
      const sanghsVal = sanghsSnap.val();
      const sanghs = (sanghsVal && typeof sanghsVal === 'object') ? Object.keys(sanghsVal).length : 0;
      await db.ref('stats').set({ users, sanghs });
    } catch (e) {
      console.warn('Failed to update public stats (non-fatal):', e);
    }
  }

  _renderOverviewFromUsers(allUsers) {
    const grid = document.getElementById('admin-overview-grid');
    if (!grid) return;

    allUsers = allUsers || {};
    const todayKey = this.getTodayKey();
    let totalUsers = 0, activeToday = 0, totalKP = 0;

    // Activity counters
    const acts = {
      navkarsi: { icon: '🌅', name: 'Navkarsi', count: 0 },
      wakeup: { icon: '⏰', name: 'Wake < 7AM', count: 0 },
      sleep: { icon: '🌙', name: 'Sleep < 12AM', count: 0 },
      pranam: { icon: '🙇', name: 'Pranam', count: 0 },
      pooja: { icon: '🪔', name: 'Jin Pooja', count: 0 },
      samayik: { icon: '🧘', name: 'Samayik', count: 0 },
      devasiya: { icon: '🌅', name: 'Devasiya', count: 0 },
      raiya: { icon: '🌙', name: 'Raiya', count: 0 },
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
        if (dayLog.raiyaDone) acts.raiya.count++;
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

  // Shared authorization + basic-shape filter — the same rules
  // _renderLeaderboardFromUsers() (below) and _collectExportRows() already
  // apply independently: admin role excluded, only uids in
  // this._adminUserUids kept, and the node must look like a real user
  // (has a role of 'user'/none, or at least a profile). Used by the
  // poster so it can never include a user outside the admin's own
  // sangh(s) or a malformed/orphaned node.
  _eligibleSanghUsers(allUsers) {
    const uids = this._adminUserUids || [];
    return Object.entries(allUsers || {})
      .filter(([uid, data]) => {
        if (!data || data.role === 'admin') return false;
        if (!uids.includes(uid)) return false;
        return !data.role || data.role === 'user' || data.profile;
      })
      .map(([uid, data]) => ({ uid, data }));
  }

  // Resolves ONE member's own sangh's point map — for admin aggregates
  // (the Excel export, the poster) that can span members of DIFFERENT
  // sanghs in a single pass. Never this admin session's own livePoints(),
  // which the admin's own role never actually uses for scoring (see
  // initUser()'s currentRole==='user' guard). Reads from
  // this._adminSanghPoints, kept fresh by the per-sangh listeners started
  // in initAdmin(); a sangh with no listener yet (or that has never been
  // customised) simply resolves to the coded defaults.
  _adminSanghPointMap(sanghCode) {
    const stored = sanghCode ? (this._adminSanghPoints || {})[sanghCode] : null;
    return resolvePointMap(stored && stored.points);
  }

  // Resolves ONE managed member's own sangh's niyam settings — for admin
  // drill-down views of a SPECIFIC member (History, Day Detail, Day Edit,
  // their row of the Monthly Stats overlay). Before per-sangh settings
  // existed, this.settings (the global node) was accurate for every member
  // regardless of sangh, since there was only one settings state in the
  // whole app — these views all read it directly. Now that sanghs can
  // genuinely differ, they must resolve THIS member's own sangh instead, or
  // an admin reviewing a Sangh B member would see Sangh A's (or their own
  // default) niyam set. Falls back to this.settings — the same value these
  // call sites always used — if the member's record or sangh code isn't
  // resolvable yet (e.g. selected before the leaderboard snapshot lands).
  _settingsForMember(uid) {
    const record = (this._adminUserRecords || {})[uid];
    const sanghCode = record && record.registration && record.registration.sanghCode;
    if (!sanghCode) return this.settings || DEFAULT_SETTINGS;
    return resolveSettings((this._adminSanghPoints || {})[sanghCode]);
  }

  // The admin-side counterpart to _settingsForMember() — same sanghCode
  // lookup, but resolving takenDates (see _extractTakenDates()) from
  // this._adminSanghAttendance (populated by _fetchAdminSanghAttendance())
  // instead of settings from this._adminSanghPoints, for
  // _renderLifetimeStats()'s attendance tiles on a drilled-into member.
  // Returns `null` (the documented "fall back to inferring from records
  // alone" signal) when the member's sangh can't be resolved yet, same as
  // an unresolvable sangh code falls back to global settings above.
  _takenDatesForMember(uid, fromKey, toKey) {
    const record = (this._adminUserRecords || {})[uid];
    const sanghCode = record && record.registration && record.registration.sanghCode;
    if (!sanghCode) return null;
    return this._extractTakenDates((this._adminSanghAttendance || {})[sanghCode], fromKey, toKey);
  }

  _renderLeaderboardFromUsers(allUsers) {
    const listEl = document.getElementById('admin-leaderboard-list');
    if (!listEl) return;

    allUsers = allUsers || {};
    const users = [];
    // Rebuilt fresh on every fetch (renderAdminLeaderboard() re-runs this
    // on tab switch and on manual refresh) so a deleted or no-longer-
    // eligible member never lingers here. Holds the FULL record — not just
    // the 4 leaderboard fields — so renderAdminUserDetails() can paint the
    // drill-down's profile card with zero extra Firebase reads.
    this._adminUserRecords = {};
    Object.entries(allUsers).forEach(([uid, data]) => {
      if (data.role === 'admin') return;
      // Strictly ONLY include users in this admin's sangh
      if (!this._adminUserUids.includes(uid)) return;
      if (!data.role || data.role === 'user' || data.profile) {
        users.push({
          uid,
          name: data.name || uid,
          rollNo: (data.registration && data.registration.rollNo) || '',
          kp: data.profile?.totalKP || 0,
          streak: data.profile?.currentStreak || 0,
          photo: data.photo || null
        });
        this._adminUserRecords[uid] = data;
      }
    });

    // Ranking stays purely by AP — that's the whole point of this tab, and
    // Roll No. is only ever a sort key on the Attendance tab (see
    // renderAttendance()'s comparator, shared via _sortByRollThenName()).
    users.sort((a, b) => b.kp - a.kp);

    if (users.length === 0) {
      listEl.innerHTML = '<div class="admin-desc">No users found. Login with a user account first.</div>';
      return;
    }

    listEl.innerHTML = users.map((u, index) => {
      const initial = (u.name || '?').trim().charAt(0).toUpperCase() || '?';
      // data-search backs _filterLeaderboard() — matched independently of
      // what .lb-name actually displays, so a roll-number prefix in the
      // visible name never has to stay in sync with what's searchable.
      const searchKey = `${u.name} ${u.rollNo}`.toLowerCase();
      return `
      <div class="leaderboard-card" data-uid="${this._escHtml(u.uid)}" data-search="${this._escHtml(searchKey)}">
        <div class="lb-rank">#${index + 1}</div>
        <div class="lb-avatar">
          ${u.photo ? `<img src="${this._escHtml(u.photo)}" alt="">` : `<span class="lb-initial">${this._escHtml(initial)}</span>`}
        </div>
        <div class="lb-info">
          <span class="lb-name">${u.rollNo ? `<span class="lb-rollno">#${this._escHtml(u.rollNo)}</span> ` : ''}${this._escHtml(u.name)}</span>
          <span class="lb-stats">${u.kp} AP • 🔥 ${u.streak}</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <div class="lb-action">👁️ View</div>
          <button class="btn-delete-card-user" data-uid="${this._escHtml(u.uid)}" data-name="${this._escHtml(u.name)}" title="Delete User" style="background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; border-radius: 8px; padding: 4px 8px; font-weight: 700; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center;">🗑️</button>
        </div>
      </div>
    `;
    }).join('');

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

    // Re-applies whatever the admin already typed into the search box —
    // renderAdminLeaderboard() rebuilds this list on every tab switch and
    // manual refresh, which would otherwise silently clear an active filter.
    this._filterLeaderboard();
  }

  // Filters the Leaderboard by name OR roll number — toggles display on the
  // EXISTING rows rather than re-rendering, so a filter never disturbs the
  // click handlers just bound above. Matches against each card's
  // data-search attribute (see _renderLeaderboardFromUsers()), not its
  // rendered text, so this stays correct regardless of how the name/roll
  // number are formatted on screen. Called on every keystroke and after
  // every rebuild (see the end of _renderLeaderboardFromUsers() above).
  _filterLeaderboard() {
    const input = document.getElementById('leaderboard-search');
    const listEl = document.getElementById('admin-leaderboard-list');
    if (!input || !listEl) return;
    const q = input.value.trim().toLowerCase();
    listEl.querySelectorAll('.leaderboard-card').forEach(row => {
      const key = row.dataset.search || '';
      row.style.display = (!q || key.includes(q)) ? '' : 'none';
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
      // 1. Remove this member's row from every sangh_members index this
      // admin can see them under — normally just their own registered
      // sangh, but a member who transferred sangh mid-session could have a
      // stray leftover under an old code, so this checks every code THIS
      // admin manages (the only ones firebase-rules.json lets them write
      // anyway) rather than assuming exactly one.
      const targetRecord = (this._adminUserRecords || {})[uidToDelete];
      const codesToCheck = new Set(this._adminSanghCodes || []);
      const ownCode = targetRecord && targetRecord.registration && targetRecord.registration.sanghCode;
      if (ownCode) codesToCheck.add(ownCode);
      await Promise.all([...codesToCheck].map(code =>
        db.ref(`sangh_members/${code}/${uidToDelete}`).remove().catch(() => {})
      ));

      // 2. Remove user main node completely (clears sanghCode, profile,
      // logs, lock_status and attendance — all nested under users/{uid})
      await db.ref(`users/${uidToDelete}`).remove();

      // (Their photo needs no separate cleanup — it lives at
      // users/{uid}/photo, so the remove() above already took it.)

      // 3. If currently viewing this user, return to leaderboard. Calls
      // _showAdminOverview() directly rather than history.back() — this is
      // a programmatic transition after a destructive action (not a user
      // back-gesture), and the alert() below is a blocking dialog whose
      // interaction with an async popstate is worth not depending on. The
      // tradeoff: the individual-view history entry this user's original
      // selectAdminUser() pushed is left in place rather than consumed, so
      // one extra (harmless, same-tab) back press may be needed afterwards.
      if (this.uid === uidToDelete) {
        this._showAdminOverview();
      }

      // 5. Refresh admin state and re-render
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
    const allUsers = await this._fetchAdminUsers();
    this._renderLeaderboardFromUsers(allUsers);
    this._renderOverviewFromUsers(allUsers);
    // Only the FIRST time this admin session refreshes the leaderboard —
    // this can be called repeatedly (tab switches, the refresh button),
    // and the landing page's counters don't need to track that closely;
    // see _updatePublicStats()'s own comment.
    if (!this._statsUpdatedThisSession) {
      this._statsUpdatedThisSession = true;
      this._updatePublicStats(allUsers);
    }
  }

  // ===== ATTENDANCE (replaces the old admin Lock tab) =====
  // TWO storage locations, written together by saveAttendance() — see the
  // v5 restructure's "Why attendance moves to a sangh-level node":
  //   users/{uid}/attendance/{YYYY-MM-DD} = { present, gathas } — the
  //     member's own private history, unchanged from v4. Survives a
  //     member transferring sangh (their old attendance stays theirs).
  //   sangh_attendance/{code}/{YYYY-MM-DD} = { presentCount, absentCount,
  //     gathaTotal, records: {uid: {present, gathas}} } — the roster-level
  //     view, new in v5. Answers "who was here on date X" in ONE read
  //     instead of scanning every managed member's own record the way v4
  //     had to (see _collectAttendanceRows()).
  //
  // Edits accumulate in this._attendanceDraft (uid -> {present, gathas})
  // and never touch Firebase until Save — a class can have 30+ members, and
  // writing on every tap would be one round trip per tap on what's often a
  // patchy pathshala-hall connection. this._attendanceDate tracks which
  // date the draft belongs to; changing the date discards it (after
  // confirming) since a draft only ever makes sense for one date at a time.

  renderAttendance() {
    const listEl = document.getElementById('attendance-list');
    const dateEl = document.getElementById('attendance-date');
    if (!listEl || !dateEl) return;

    if (!dateEl.value) dateEl.value = this.getTodayKey();
    const dateKey = dateEl.value;

    // A genuine date change starts a fresh, empty draft — attendance edits
    // are per-date and must never silently carry over onto a different day.
    // Re-rendering the SAME date (e.g. switching tabs away and back) must
    // NOT reset an in-progress, unsaved draft.
    if (this._attendanceDate !== dateKey) {
      this._attendanceDate = dateKey;
      this._clearAttendanceDraft();
    }

    if (!this._adminUserRecords) {
      listEl.innerHTML = '<div style="text-align:center; padding: 20px; color: #795548;">Loading users...</div>';
      return;
    }

    // Roll-number order (members with one first, ascending; unnumbered
    // members after, alphabetical) — the raw snapshot order
    // (_eligibleSanghUsers()) is Firebase's lexicographic uid order,
    // meaningless to a human marking a class. Shared with the Attendance
    // export's own sort (_collectAttendanceRows()) via
    // _sortByRollThenName() — they're stated to match each other.
    const members = this._eligibleSanghUsers(this._adminUserRecords)
      .sort((a, b) => this._sortByRollThenName(
        { name: a.data.name || a.uid, rollNo: (a.data.registration && a.data.registration.rollNo) || '' },
        { name: b.data.name || b.uid, rollNo: (b.data.registration && b.data.registration.rollNo) || '' }
      ));
    if (members.length === 0) {
      listEl.innerHTML = '<div class="admin-desc">No users found. Login with a user account first.</div>';
      return;
    }

    const draft = this._attendanceDraft || {};
    listEl.innerHTML = members.map(({ uid, data }) => {
      const name = data.name || uid;
      const rollNo = (data.registration && data.registration.rollNo) || '';
      const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
      const saved = (data.attendance && data.attendance[dateKey]) || null;
      const d = draft[uid];
      const present = d ? !!d.present : !!(saved && saved.present);
      const gathas = d ? (d.gathas || 0) : ((saved && saved.gathas) || 0);
      // data-search backs _filterAttendance() — see _renderLeaderboardFromUsers()'s
      // identical pattern.
      const searchKey = `${name} ${rollNo}`.toLowerCase();
      return `
      <div class="attendance-row${present ? '' : ' is-absent'}" data-uid="${this._escHtml(uid)}" data-search="${this._escHtml(searchKey)}">
        <div class="lb-avatar">
          ${data.photo ? `<img src="${this._escHtml(data.photo)}" alt="">` : `<span class="lb-initial">${this._escHtml(initial)}</span>`}
        </div>
        <div class="lb-info"><span class="lb-name">${rollNo ? `<span class="lb-rollno">#${this._escHtml(rollNo)}</span> ` : ''}${this._escHtml(name)}</span></div>
        <label class="attendance-present-toggle">
          <input type="checkbox" class="attendance-present-checkbox" data-uid="${this._escHtml(uid)}" ${present ? 'checked' : ''}>
          <span>Present</span>
        </label>
        <div class="attendance-gatha-group">
          <span class="attendance-gatha-label">Gathas</span>
          <div class="counter-actions">
            <button type="button" class="btn-counter-small btn-minus attendance-gatha-minus" data-uid="${this._escHtml(uid)}">−</button>
            <span class="counter-val attendance-gatha-val" data-uid="${this._escHtml(uid)}">${gathas}</span>
            <button type="button" class="btn-counter-small btn-plus attendance-gatha-plus" data-uid="${this._escHtml(uid)}">+</button>
          </div>
        </div>
      </div>
    `;
    }).join('');

    // Re-applies whatever the admin already typed into the search box —
    // renderAttendance() rebuilds this list's innerHTML on every date
    // change, so a filter left unre-applied would silently clear itself.
    this._filterAttendance();
  }

  // Same idea as _filterLeaderboard() — toggles display on existing rows,
  // never re-renders, so an in-progress attendance draft is never disturbed
  // by typing into the search box. Matches name OR roll number via each
  // row's data-search attribute.
  _filterAttendance() {
    const input = document.getElementById('attendance-search');
    const listEl = document.getElementById('attendance-list');
    if (!input || !listEl) return;
    const q = input.value.trim().toLowerCase();
    listEl.querySelectorAll('.attendance-row').forEach(row => {
      const key = row.dataset.search || '';
      row.style.display = (!q || key.includes(q)) ? '' : 'none';
    });
  }

  // Shared ordering for the Attendance tab (renderAttendance()) and its
  // Excel export (_collectAttendanceRows()) — deliberately the SAME
  // comparator so a class register reads identically on screen and on
  // paper. Members WITH a roll number sort first, ascending NUMERICALLY
  // (so "10" comes after "9", not before it as a string sort would give);
  // members without one follow, alphabetical by name. `a`/`b` need only
  // `{ name, rollNo }` — rollNo may be '' (unset).
  _sortByRollThenName(a, b) {
    const ra = a.rollNo, rb = b.rollNo;
    if (ra && rb) return (parseInt(ra, 10) - parseInt(rb, 10)) || a.name.localeCompare(b.name);
    if (ra && !rb) return -1;
    if (!ra && rb) return 1;
    return a.name.localeCompare(b.name);
  }

  // Lazily creates a draft entry for uid, seeded from whatever is CURRENTLY
  // rendered in that row (which already reflects saved-or-draft) rather
  // than a hardcoded {present:false, gathas:0} — otherwise touching only
  // the gatha counter would silently reset an already-ticked Present box
  // back to unchecked the moment a draft entry was created for that uid.
  _getOrInitAttendanceDraft(uid) {
    if (!this._attendanceDraft) this._attendanceDraft = {};
    if (!this._attendanceDraft[uid]) {
      const row = document.querySelector(`.attendance-row[data-uid="${uid}"]`);
      const cb = row ? row.querySelector('.attendance-present-checkbox') : null;
      const valEl = row ? row.querySelector('.attendance-gatha-val') : null;
      this._attendanceDraft[uid] = {
        present: cb ? cb.checked : false,
        gathas: valEl ? (parseInt(valEl.textContent, 10) || 0) : 0
      };
    }
    return this._attendanceDraft[uid];
  }

  _markAttendanceDirty() {
    this._attendanceDirty = true;
    const ind = document.getElementById('attendance-unsaved-indicator');
    if (ind) ind.classList.remove('hidden');
  }

  _clearAttendanceDraft() {
    this._attendanceDraft = {};
    this._attendanceDirty = false;
    const ind = document.getElementById('attendance-unsaved-indicator');
    if (ind) ind.classList.add('hidden');
  }

  _markAllAttendancePresent() {
    const listEl = document.getElementById('attendance-list');
    if (!listEl) return;
    // Scoped to rows the search filter is currently showing — with an
    // empty search that's every row (today's behaviour exactly), but a
    // member hidden by an active search must never be silently marked
    // present without the admin seeing them.
    listEl.querySelectorAll('.attendance-row').forEach(row => {
      if (row.style.display === 'none') return;
      const uid = row.dataset.uid;
      const cb = row.querySelector('.attendance-present-checkbox');
      if (cb && !cb.checked) {
        cb.checked = true;
        row.classList.remove('is-absent');
      }
      this._getOrInitAttendanceDraft(uid).present = true;
    });
    this._markAttendanceDirty();
  }

  async saveAttendance() {
    const dateKey = this._attendanceDate;
    const draft = this._attendanceDraft || {};
    const uids = Object.keys(draft);
    if (!dateKey || uids.length === 0) {
      this._clearAttendanceDraft();
      return;
    }

    // Two copies, written in this order — see the v5 restructure plan's
    // "Why attendance moves to a sangh-level node": users/{uid}/attendance
    // stays the member's own private history (unchanged shape from v4);
    // sangh_attendance/{code}/{date} is the NEW roster-level view a whole
    // class's presence can be read from in one read, instead of scanning
    // every member's own record. Grouped by sangh since the attendance
    // list spans every sangh this admin manages in one flat register, so
    // a single save can touch more than one.
    const userUpdates = {};
    const bySangh = {}; // code -> { uid -> {present, gathas} }
    uids.forEach(uid => {
      const rec = {
        present: !!draft[uid].present,
        gathas: Math.max(0, parseInt(draft[uid].gathas, 10) || 0)
      };
      userUpdates[`${uid}/attendance/${dateKey}`] = rec;
      const record = (this._adminUserRecords || {})[uid];
      const sanghCode = record && record.registration && record.registration.sanghCode;
      if (!sanghCode) return;
      (bySangh[sanghCode] || (bySangh[sanghCode] = {}))[uid] = rec;
    });

    const saveBtn = document.getElementById('btn-save-attendance');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
    try {
      // 1. The member's own copy — the write the admin is actually
      // waiting on; a failure here is the only one that should be
      // reported as "attendance failed to save".
      await db.ref('users').update(userUpdates);

      // 2. The sangh-level roster view, per sangh this save touched.
      // Best-effort and its OWN try/catch per sangh — a failure here must
      // never be reported as "attendance failed to save" when the member
      // records above just did. Reads the FULL existing record set for
      // this date first (not just this save's delta) so presentCount/
      // absentCount/gathaTotal reflect everyone marked on this date, not
      // only whoever this particular save touched — an earlier visit may
      // already have marked other members for the same date.
      for (const [code, newRecords] of Object.entries(bySangh)) {
        try {
          const dateRef = db.ref(`sangh_attendance/${code}/${dateKey}`);
          const existingSnap = await dateRef.child('records').once('value');
          const merged = { ...(existingSnap.val() || {}), ...newRecords };
          let presentCount = 0, absentCount = 0, gathaTotal = 0;
          Object.values(merged).forEach(r => {
            if (r && r.present) presentCount++; else absentCount++;
            gathaTotal += (r && r.gathas) || 0;
          });
          const update = {
            presentCount, absentCount, gathaTotal,
            takenAt: new Date().toISOString(),
            takenBy: (this._currentAuthUser && this._currentAuthUser.baseUid) || null,
          };
          Object.entries(newRecords).forEach(([uid, rec]) => { update[`records/${uid}`] = rec; });
          await dateRef.update(update);
          // Keep the just-fetched cache current too, so a taken-dates
          // check immediately after this save (e.g. re-opening this same
          // date) doesn't have to wait for the listener/next fetch.
          if (!this._adminSanghAttendance) this._adminSanghAttendance = {};
          if (!this._adminSanghAttendance[code]) this._adminSanghAttendance[code] = {};
          this._adminSanghAttendance[code][dateKey] = { ...update, records: merged };
        } catch (e) {
          console.warn(`Attendance saved, but updating the sangh_attendance roster for "${code}" failed (self-heals on next export):`, e);
        }
      }

      this._clearAttendanceDraft();
    } catch (e) {
      console.error('Failed to save attendance:', e);
      alert('Failed to save attendance. Please check your connection and try again.');
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save Attendance'; }
    }
  }

  // ===== EXCEL EXPORT (ADMIN LEADERBOARD) =====

  // Pure data step — no DOM, no network. Uses _eligibleSanghUsers() (the
  // same authorization + shape filter the attendance export and the poster
  // already share) so the export can never leak users outside the admin's
  // own sangh(s) — this used to duplicate that filter inline and was
  // missing its "looks like a real user" shape check, so a malformed or
  // orphaned node could slip into this sheet but not the others. Per-niyam
  // columns come from _computeNiyamRange() — the same "days followed"
  // definition as the lifetime stats grid and the Monthly Niyam Stats
  // overlay — so the sheet can never disagree with the app. `settings` is
  // the one shared sangh-wide node, so every row is measured against the
  // same enabled niyams in the same order.
  // `takenDates` — see _resolveAttendanceTakenDates(); passed straight
  // through to _summarizeAttendance() so this sheet's attendance columns
  // apply the exact same stricter absence rule as the dedicated Attendance
  // export, rather than the two silently disagreeing.
  _collectExportRows(allUsers, fromKey, toKey, takenDates) {
    const s = this.settings || DEFAULT_SETTINGS;
    const rows = this._eligibleSanghUsers(allUsers).map(({ uid, data }) => {
      const logs = data.daily_logs || {};
      // Each member scored at THEIR OWN sangh's point values — this export
      // can span an admin's several sanghs in one pass.
      const sanghCode = data.registration && data.registration.sanghCode;
      const pointsMap = this._adminSanghPointMap(sanghCode);
      const { stats, daysLogged, perfectDays, totalAP } = this._computeNiyamRange(logs, fromKey, toKey, s, true, pointsMap);

      // Days-followed summed across every niyam — unit-consistent even
      // though the niyams themselves aren't (Samayik counts times, Book
      // Reading/Screen Time count minutes): `days` is populated for ALL of
      // them, and Screen Time (the one penalty) always contributes 0 here
      // since its countsDay() is permanently false — see NIYAM_STATS.
      const totalNiyams = stats.reduce((t, st) => t + st.days, 0);

      const attendance = this._summarizeAttendance(data.attendance, fromKey, toKey, takenDates);

      return {
        name: data.name || uid,
        rollNo: (data.registration && data.registration.rollNo) || '',
        stats, totalNiyams, totalAP, daysLogged, perfectDays,
        daysPresent: attendance.daysPresent,
        daysAbsent: attendance.daysAbsent,
        totalGathas: attendance.totalGathas,
        attendancePct: attendance.pct,
      };
    });

    rows.sort((a, b) => b.totalAP - a.totalAP);
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
      // Scoped to this admin's own managed sangh(s), not a whole-`users`
      // download — see _fetchAdminUsers()'s own comment. Re-fetched fresh
      // here (rather than reusing this._adminUserRecords) so an export
      // always reflects the very latest data, not whatever the leaderboard
      // happened to have cached from its last visit.
      const allUsers = await this._fetchAdminUsers();
      await this._fetchAdminSanghAttendance();
      // Same taken-dates resolution the Attendance export uses, so this
      // sheet's attendance columns can never disagree with that one — see
      // _resolveAttendanceTakenDates()'s own comment.
      const takenDates = await this._resolveAttendanceTakenDates(fromKey, toKey);
      const rows = this._collectExportRows(allUsers, fromKey, toKey, takenDates);

      if (rows.length === 0) {
        showError('No users found for your sangh in this range.');
        return;
      }

      // Every row's `stats` array has the same shape and order (one shared
      // `settings` node determines which niyams are enabled for everyone),
      // so the first row's stats safely define the column headers.
      const niyamLabels = rows[0].stats.map(st => `${st.label}${st.exportUnit ? ` (${st.exportUnit})` : ''}`);
      const noteRow = [
        "Niyam columns show days followed in the selected range (or the total amount, for columns with a unit in their header). " +
        "Total Niyams sums days-followed across every niyam (never the raw amount columns, which are in different units). " +
        "The TOTAL row sums each column down; Attendance % on that row is the sangh-wide ratio, not a sum of percentages."
      ];
      const header = [
        'Name', 'Roll No.', ...niyamLabels, 'Total Niyams', 'Total AP', 'Days Logged', 'Perfect Days',
        'Days Present', 'Days Absent', 'Total Gathas', 'Attendance %'
      ];
      const aoa = [noteRow, header];
      rows.forEach(r => {
        const niyamValues = r.stats.map(st => st.amount != null ? st.amount : st.days);
        aoa.push([
          r.name, r.rollNo, ...niyamValues, r.totalNiyams, r.totalAP, r.daysLogged, r.perfectDays,
          r.daysPresent, r.daysAbsent, r.totalGathas, `${r.attendancePct}%`
        ]);
      });

      // TOTAL row — a plain sum down each column is always unit-safe WITHIN
      // a column (e.g. total minutes the sangh read, total member-days a
      // niyam was followed), even though summing ACROSS columns would mix
      // units. Attendance % is recomputed sangh-wide from the summed
      // present/absent counts rather than summed itself, so it stays a real
      // percentage instead of a meaningless sum-of-percentages.
      const sumCol = (fn) => rows.reduce((t, r) => t + fn(r), 0);
      const niyamTotals = niyamLabels.map((_, i) =>
        sumCol(r => (r.stats[i].amount != null ? r.stats[i].amount : r.stats[i].days))
      );
      const totalDaysPresent = sumCol(r => r.daysPresent);
      const totalDaysAbsent = sumCol(r => r.daysAbsent);
      const totalMarked = totalDaysPresent + totalDaysAbsent;
      const sanghPct = totalMarked > 0 ? Math.round((totalDaysPresent / totalMarked) * 100) : 0;
      aoa.push([
        'TOTAL', '', ...niyamTotals, sumCol(r => r.totalNiyams), sumCol(r => r.totalAP),
        sumCol(r => r.daysLogged), sumCol(r => r.perfectDays),
        totalDaysPresent, totalDaysAbsent, sumCol(r => r.totalGathas), `${sanghPct}%`
      ]);

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

  // ===== EXCEL EXPORT (ATTENDANCE) =====

  // Summarises one member's attendance records inside [fromKey, toKey] —
  // the single definition of these numbers, shared by the export sheet and
  // the user-facing "My Attendance" view. daysMarked counts ONLY dates that
  // actually carry a record: a pathshala meeting weekly leaves most
  // calendar days with no record at all, and counting those as absences
  // used to report a perfectly-attending member at roughly 14%. A day
  // nobody was marked on means the class didn't meet — it is not an
  // absence. Gathas are summed unconditionally, independent of daysMarked.
  // Extracts the Set of dateKeys within [fromKey, toKey] from a raw
  // sangh_attendance/{code} node — its own child keys ARE the taken dates
  // (see saveAttendance()); a date the class never met simply has no key
  // there at all, so unlike v4 there is no separate `attendanceDates`
  // child to reach into. `node` is this._sanghAttendanceNode
  // (member-facing "My Attendance", live-listened in setupRealtimeSync())
  // or this._adminSanghAttendance[code] (admin aggregates, fetched by
  // _fetchAdminSanghAttendance()). Returns `null`, never an empty Set,
  // when the WHOLE node is missing (this sangh has never taken attendance
  // at all) — that distinction is what tells
  // _summarizeAttendance()/_collectAttendanceRows() apart "nothing known,
  // infer from records" from "known, and there simply were none in this
  // particular range".
  _extractTakenDates(node, fromKey, toKey) {
    if (!node) return null;
    const set = new Set();
    Object.keys(node).forEach(dateKey => {
      if (dateKey >= fromKey && dateKey <= toKey) set.add(dateKey);
    });
    return set;
  }

  // Fetches sangh_attendance/{code} for every sangh this admin manages,
  // caching the raw nodes into this._adminSanghAttendance — the admin-side
  // counterpart to the member's live sangh_attendance listener
  // (setupRealtimeSync()). Not live: called on demand (renderAdminLeaderboard(),
  // and again just before an export needs the freshest possible picture)
  // rather than a persistent per-sangh listener, matching _fetchAdminUsers()'s
  // "scoped, one-shot" pattern rather than v4's always-on subscriptions.
  async _fetchAdminSanghAttendance() {
    const codes = this._adminSanghCodes || [];
    this._adminSanghAttendance = {};
    if (codes.length === 0) return;
    const snaps = await Promise.all(codes.map(code =>
      db.ref(`sangh_attendance/${code}`).once('value').catch(e => {
        console.warn(`Failed to read sangh_attendance/${code}:`, e);
        return null;
      })
    ));
    codes.forEach((code, i) => {
      this._adminSanghAttendance[code] = (snaps[i] && snaps[i].val()) || null;
    });
  }

  // Admin-side resolution of _extractTakenDates() across every sangh this
  // admin manages (the attendance register spans all of them as one flat
  // list — see _eligibleSanghUsers()), unioned into a single Set. No
  // backfill needed in v5: saveAttendance() writes a member's own
  // users/{uid}/attendance AND the sangh_attendance roster view in the
  // same operation, so (barring a genuinely failed write, left for manual
  // correction) the two can no longer independently drift the way v4's
  // separately-added attendanceDates child could for pre-existing data.
  // Callers must call _fetchAdminSanghAttendance() first — this reads
  // only from that cache. Returns `null`, matching _extractTakenDates(),
  // when nothing is known for any managed sangh in range — true fallback.
  async _resolveAttendanceTakenDates(fromKey, toKey) {
    const codes = this._adminSanghCodes || [];
    const takenDates = new Set();
    let anyKnown = false;
    codes.forEach(code => {
      const node = (this._adminSanghAttendance || {})[code];
      if (node) anyKnown = true;
      this._extractTakenDates(node, fromKey, toKey)?.forEach(d => takenDates.add(d));
    });
    return anyKnown ? takenDates : null;
  }

  // `takenDates` — see _extractTakenDates(): a Set (possibly empty) of
  // dates known to have been taken, or `null` when nothing is known for
  // this sangh/range at all.
  _summarizeAttendance(attendance, fromKey, toKey, takenDates) {
    let daysPresent = 0, daysAbsent = 0, totalGathas = 0;
    const att = attendance || {};

    if (takenDates) {
      // Strict rule: every date KNOWN to have been taken counts — present
      // if marked so, absent otherwise, including no record at all. This
      // is what makes an unmarked member on a day the class ran count as
      // absent rather than silently not counting either way.
      takenDates.forEach(dateKey => {
        const rec = att[dateKey];
        if (rec && rec.present) daysPresent++; else daysAbsent++;
      });
      Object.entries(att).forEach(([dateKey, rec]) => {
        if (!rec || dateKey < fromKey || dateKey > toKey) return;
        totalGathas += (rec.gathas || 0);
      });
    } else {
      // Fallback — this sangh has no sangh_attendance data at all for this
      // range (attendance has never been taken, or the read failed):
      // infer purely from whichever per-member records exist.
      Object.entries(att).forEach(([dateKey, rec]) => {
        if (!rec || dateKey < fromKey || dateKey > toKey) return;
        totalGathas += (rec.gathas || 0);
        if (rec.present) daysPresent++; else daysAbsent++;
      });
    }

    const daysMarked = daysPresent + daysAbsent;
    return {
      daysPresent, daysAbsent, daysMarked, totalGathas,
      pct: daysMarked > 0 ? Math.round((daysPresent / daysMarked) * 100) : 0,
    };
  }

  // Pure data step — no DOM, no network. Same authorization filter as the
  // points export (_eligibleSanghUsers()). Columns are exactly the known
  // taken dates (see _extractTakenDates()/_resolveAttendanceTakenDates()) —
  // a day the class never ran gets no column at all, rather than a '—'
  // cell for every member. Only when `takenDates` is `null` (nothing known
  // for this range yet) does every calendar date in [fromKey, toKey] still
  // get a column, exactly as before this change. Cells are 'P' or 'A' —
  // never '—' — matching the stricter absence rule
  // _summarizeAttendance() applies with the same `takenDates`, so the grid
  // and the Summary sheet can never disagree. Dates are parsed/re-formatted
  // via LOCAL date components throughout (never toISOString(), which is
  // UTC and can drift a day near midnight), matching the YYYY-MM-DD keys
  // attendance/{date} is already stored under.
  _collectAttendanceRows(allUsers, fromKey, toKey, takenDates) {
    const allDateKeys = [];
    const cursor = new Date(`${fromKey}T00:00:00`);
    const end = new Date(`${toKey}T00:00:00`);
    while (cursor <= end) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      allDateKeys.push(`${y}-${m}-${d}`);
      cursor.setDate(cursor.getDate() + 1);
    }
    const dateKeys = takenDates ? allDateKeys.filter(k => takenDates.has(k)) : allDateKeys;

    const rows = this._eligibleSanghUsers(allUsers).map(({ uid, data }) => {
      const attendance = data.attendance || {};
      const presentCells = [];
      const gathaCells = [];
      dateKeys.forEach(dateKey => {
        const rec = attendance[dateKey];
        presentCells.push(rec && rec.present ? 'P' : 'A');
        gathaCells.push((rec && rec.gathas) || 0);
      });
      const summary = this._summarizeAttendance(attendance, fromKey, toKey, takenDates);
      return {
        name: data.name || uid,
        rollNo: (data.registration && data.registration.rollNo) || '',
        presentCells,
        gathaCells,
        daysPresent: summary.daysPresent,
        daysAbsent: summary.daysAbsent,
        totalGathas: summary.totalGathas,
        pct: summary.pct,
      };
    });

    // Roll-number order — the SAME comparator renderAttendance() sorts its
    // on-screen rows with (_sortByRollThenName()), so this export can never
    // disagree with the marking list it's exported from. The points export
    // alone keeps its Total AP ranking.
    rows.sort((a, b) => this._sortByRollThenName(a, b));
    return { dateKeys, rows };
  }

  openAttendanceExportDialog() {
    const errorEl = document.getElementById('attendance-export-error');
    if (errorEl) errorEl.classList.add('hidden');

    const fromEl = document.getElementById('attendance-export-from');
    const toEl = document.getElementById('attendance-export-to');
    if (fromEl && !fromEl.value) {
      const now = new Date();
      fromEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    if (toEl && !toEl.value) toEl.value = this.getTodayKey();

    const o = document.getElementById('attendance-export-overlay');
    if (o) { o.classList.remove('hidden'); o.classList.add('show'); }
  }

  closeAttendanceExportDialog() {
    const o = document.getElementById('attendance-export-overlay');
    if (o) { o.classList.remove('show'); o.classList.add('hidden'); }
  }

  async runAttendanceExport() {
    const fromEl = document.getElementById('attendance-export-from');
    const toEl = document.getElementById('attendance-export-to');
    const errorEl = document.getElementById('attendance-export-error');
    const btn = document.getElementById('btn-run-attendance-export');
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
      // Scoped to this admin's own managed sangh(s), not a whole-`users`
      // download — see _fetchAdminUsers()'s own comment.
      const allUsers = await this._fetchAdminUsers();
      await this._fetchAdminSanghAttendance();
      // Resolves which dates were actually taken — see
      // _resolveAttendanceTakenDates()'s own comment. Must happen before
      // _collectAttendanceRows() so its columns reflect it.
      const takenDates = await this._resolveAttendanceTakenDates(fromKey, toKey);
      const { dateKeys, rows } = this._collectAttendanceRows(allUsers, fromKey, toKey, takenDates);

      if (rows.length === 0) {
        showError('No users found for your sangh in this range.');
        return;
      }
      if (dateKeys.length === 0) {
        showError('No attendance was recorded in this date range.');
        return;
      }

      // Per-date totals at the top, plus a grand-total final column — the
      // member rows below leave that column blank; per-member totals
      // already live on the Summary sheet.
      const presentTotals = dateKeys.map((_, i) => rows.reduce((sum, r) => sum + (r.presentCells[i] === 'P' ? 1 : 0), 0));
      const absentTotals = dateKeys.map((_, i) => rows.reduce((sum, r) => sum + (r.presentCells[i] === 'A' ? 1 : 0), 0));
      const attHeader = ['Name', 'Roll No.', ...dateKeys, 'Total'];
      const attAoa = [
        attHeader,
        ['Total Present', '', ...presentTotals, presentTotals.reduce((a, b) => a + b, 0)],
        ['Total Absent', '', ...absentTotals, absentTotals.reduce((a, b) => a + b, 0)],
        ...rows.map(r => [r.name, r.rollNo, ...r.presentCells, '']),
      ];
      const attWs = XLSX.utils.aoa_to_sheet(attAoa);
      attWs['!cols'] = attHeader.map((h, i) => ({ wch: i === 0 ? 20 : 12 }));

      const gathaTotals = dateKeys.map((_, i) => rows.reduce((sum, r) => sum + (r.gathaCells[i] || 0), 0));
      const gathaHeader = ['Name', 'Roll No.', ...dateKeys, 'Total'];
      const gathaAoa = [
        gathaHeader,
        ['Total Gathas', '', ...gathaTotals, gathaTotals.reduce((a, b) => a + b, 0)],
        ...rows.map(r => [r.name, r.rollNo, ...r.gathaCells, '']),
      ];
      const gathaWs = XLSX.utils.aoa_to_sheet(gathaAoa);
      gathaWs['!cols'] = gathaHeader.map((h, i) => ({ wch: i === 0 ? 20 : 12 }));

      const summaryHeader = ['Name', 'Roll No.', 'Days Present', 'Days Absent', 'Total Gathas', 'Attendance %'];
      const summaryAoa = [summaryHeader, ...rows.map(r =>
        [r.name, r.rollNo, r.daysPresent, r.daysAbsent, r.totalGathas, `${r.pct}%`]
      )];
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoa);
      summaryWs['!cols'] = summaryHeader.map(h => ({ wch: Math.max(12, h.length + 2) }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, attWs, 'Attendance');
      XLSX.utils.book_append_sheet(wb, gathaWs, 'Gathas');
      XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
      XLSX.writeFile(wb, `MyNiyam_Attendance_${fromKey}_to_${toKey}.xlsx`);

      this.closeAttendanceExportDialog();
    } catch (e) {
      console.error('Attendance export failed:', e);
      showError('Export failed. Please try again.');
    } finally {
      if (btn) btn.disabled = false;
      if (btnSpan) btnSpan.textContent = originalLabel;
    }
  }

  // Resets all per-user admin view state to defaults. Used both when
  // selecting a NEW user (so stale state from whoever was viewed before
  // can't leak into the new selection) and when clearing the selection
  // entirely, via _clearAdminSelection() below.
  _resetAdminUserState() {
    this.profile = { ...DEFAULT_PROFILE };
    this.dailyLog = { ...DEFAULT_DAILY_LOG, date: this.getTodayKey() };
    this.currentDayLocked = false;
    this.currentDayLockValue = null;
    // The all-daily_logs listener that populates this is intentionally not
    // part of setupRealtimeSync()'s awaited Promise.all, so without this
    // reset a niyam-stats/history read could momentarily reuse the
    // PREVIOUS user's cached logs before the new listener fires.
    this._cachedDailyLogs = null;
    // Same reasoning — the attendance listener is also deliberately
    // non-awaited (see setupRealtimeSync()), so without this an admin
    // switching between members could briefly show one member's attendance
    // under a different member's name.
    this._cachedAttendance = null;
  }

  // Clears the admin's current user selection entirely — no lingering uid,
  // profile, lock state, or daily log from whichever user was last viewed.
  // Must run whenever the admin is NOT looking at a specific user: on
  // initAdmin() (a fresh session defaults this.uid to the admin's OWN uid
  // otherwise), "← Back" to the leaderboard, and after deleting the
  // currently-viewed user.
  _clearAdminSelection() {
    this._detachAllListeners();
    this._adminSelectedUid = null;
    this._adminSelectedName = null;
    this.uid = null;
    this._resetAdminUserState();
  }

  // Resets the Progress tab's individual-user sub-view back to the
  // aggregate overview and clears the selection — but does NOT touch which
  // admin tab is active. Shared by the admin nav (any direct tap on a
  // bottom-nav tab always wants a fresh view, never a stale drill-down left
  // over from a previous selectAdminUser()) and _showAdminOverview() below
  // (which additionally navigates back to the Leaderboard tab). Safe to
  // call even when nothing is selected — every step is a no-op then.
  _resetAdminProgressView() {
    const individualEl = document.getElementById('admin-individual');
    const overviewEl = document.getElementById('admin-overview');
    if (individualEl) individualEl.classList.add('hidden');
    if (overviewEl) overviewEl.classList.remove('hidden');
    this._clearAdminSelection();
    window.scrollTo(0, 0); // returning to the overview is its own "page" — see switchTab()'s comment
  }

  // The "← Back" button's full behavior, extracted so the device back
  // button (_navOnPopState()'s admin branch) and deleteAdminUser()'s
  // return-to-leaderboard path trigger the exact same thing the button
  // does — never two slightly different implementations that could drift.
  _showAdminOverview() {
    this._resetAdminProgressView();
    this.switchAdminTab('admin-leaderboard');
  }

  async selectAdminUser(uid) {
    // Detach old user listeners (but keep leaderboard listener alive)
    this._detachAllListeners();

    // Set new target
    this.uid = uid;
    this._adminSelectedUid = uid;
    this.initializing = true;

    // Initialize defaults so renderAdminProgress doesn't read undefined
    this._resetAdminUserState();
    this.settings = { ...DEFAULT_SETTINGS };

    // Show the individual view, hide the overview
    document.getElementById('admin-overview').classList.add('hidden');
    document.getElementById('admin-individual').classList.remove('hidden');
    window.scrollTo(0, 0); // drilling into a member is its own "page" — see switchTab()'s comment
    // Clear the previous member's profile card immediately — it holds
    // personal details (phone, photo), so it must never flash a DIFFERENT
    // member's data while this one's record resolves below.
    const detailsCardEl = document.getElementById('admin-profile-details');
    if (detailsCardEl) detailsCardEl.innerHTML = '';

    const nameEl = document.getElementById('admin-viewing-name');

    // The leaderboard fetch already has this user's full record in memory
    // (see _renderLeaderboardFromUsers()) — only fall back to a direct
    // read if that cache somehow missed them (e.g. selected before the
    // leaderboard has finished its first fetch this session).
    let record = (this._adminUserRecords || {})[uid];
    if (!record) {
      const recSnap = await db.ref(`users/${uid}`).once('value');
      record = recSnap.val() || {};
    }
    const userName = record.name || uid;
    this._adminSelectedName = userName;
    if (nameEl) nameEl.textContent = `Viewing: ${userName}`;
    this.renderAdminUserDetails(record);

    // Reset admin history state to current month for new user
    const now = new Date();
    this._adminHistoryMonth = now.getMonth();
    this._adminHistoryYear = now.getFullYear();
    
    // Selecting a user is its own back-navigable step, pushed BEFORE the
    // tab switch below — same "push first" ordering as the nav handlers,
    // and for the same reason: switchAdminTab()'s replaceState must land on
    // the entry we're arriving at, not the one we're leaving. Always
    // reached from the Leaderboard tab (the only place a user card can be
    // clicked), so this never collides with a same-tab re-tap the way the
    // nav handlers' guard exists for.
    history.pushState({ tab: 'admin-progress', overlay: null }, '');
    this.switchAdminTab('admin-progress');

    // Start real-time syncing for this user's data
    await this.setupRealtimeSync();
    
    this.initializing = false;
    this.loadAdminSettingsUI();
    this.renderAdminProgress();
    this._renderAdminUnlockButton();
    this.renderAdminHistory();
  }

  // ===== NIYAM REGISTRY — CARD RENDERING =====
  // Builds one dashboard card per NIYAM_REGISTRY entry (data.js) into the two
  // new Home sections, reusing the exact same CSS classes as the built-in
  // cards so no new styles are needed. Called once per dashboard load,
  // before setupUserEventListeners() — see initUser(). renderActivities()
  // only ever updates these cards' state afterwards (show/hide, .completed,
  // text); it never rebuilds them, so the listeners bound below are never
  // lost. entries that failed registerNiyams()'s validation have no `.flag`
  // and are silently skipped here too — already logged once, no need to
  // repeat the warning on every render.
  _renderRegistryCards() {
    const containers = {
      bhakti: document.getElementById('cat-bhakti'),
      aachar: document.getElementById('cat-aachar'),
    };
    if (!containers.bhakti && !containers.aachar) return;

    (typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : []).forEach(entry => {
      if (!entry.flag) return;
      // A built-in's card is already hand-written in index.html (with its
      // own counters/steppers) — generating a second one would duplicate it.
      if (entry.builtIn) return;
      const container = containers[entry.section];
      if (!container) return;
      const html = this._buildRegistryCardHtml(entry);
      if (html) container.insertAdjacentHTML('beforeend', html);
    });
  }

  _buildRegistryCardHtml(entry) {
    switch (entry.layout) {
      case 'simple': return this._buildRegistrySimpleCardHtml(entry);
      case 'dependent': return this._buildRegistryDependentCardHtml(entry);
      case 'dual': return this._buildRegistrySlotCardHtml(entry, false);
      case 'exclusive': return this._buildRegistrySlotCardHtml(entry, true);
      default: return '';
    }
  }

  // Mirrors the built-in .activity-compact cards (e.g. Kandmool Tyag) exactly
  // — same ids the generic toggleSimpleActivity()/updateSimpleCard() already
  // expect, so both are reused as-is for these cards.
  _buildRegistrySimpleCardHtml(entry) {
    const item = entry.items[0];
    const icon = item.icon || entry.icon || '';
    return `
      <div class="activity-compact" id="${entry.id}-card">
        <div class="lock-indicator hidden" id="${entry.id}-lock">🔒</div>
        <div class="compact-left">
          <span class="card-icon">${icon}</span>
          <div class="compact-info">
            <span class="card-title">${item.label}</span>
            <span class="card-title-hindi">${item.labelHindi || ''}</span>
          </div>
        </div>
        <div class="compact-actions">
          <button class="btn-complete-small" id="btn-${entry.id}" data-point-key="${item.prop}" data-point-format="+{n} AP">+${item.points} AP</button>
          <button class="btn-undo-small hidden" id="btn-${entry.id}-undo">Undo</button>
        </div>
      </div>`;
  }

  // Mirrors the built-in Pooja + Ashta Prakari card exactly (parent
  // complete/undo button, child checkbox that only scores while the parent
  // is done).
  _buildRegistryDependentCardHtml(entry) {
    const [parent, child] = entry.items;
    const icon = parent.icon || entry.icon || '';
    return `
      <div class="activity-compact" id="${entry.id}-card">
        <div class="lock-indicator hidden" id="${entry.id}-lock">🔒</div>
        <div class="compact-left">
          <span class="card-icon">${icon}</span>
          <div class="compact-info">
            <span class="card-title">${parent.label}</span>
            <span class="card-title-hindi">${parent.labelHindi || ''}</span>
          </div>
        </div>
        <div class="compact-actions pooja-complex-actions">
          <label class="ashta-toggle">
            <input type="checkbox" id="${entry.id}-child-checkbox">
            <span data-point-key="${child.prop}" data-point-format="${this._escHtml(child.label)} (+{n})">${child.label} (+${child.points})</span>
          </label>
          <button class="btn-complete-small" id="btn-${entry.id}" data-point-key="${parent.prop}" data-point-format="+{n} AP">+${parent.points} AP</button>
          <button class="btn-undo-small hidden" id="btn-${entry.id}-undo">Undo</button>
        </div>
      </div>`;
  }

  // Shared by 'dual' (independent toggles, like the built-in Pratikraman
  // card) and 'exclusive' (pick at most one, like Tapasya's 4 levels) — same
  // slot-button markup either way, for ANY number of items >= 2; only the
  // click semantics differ (bound separately in _bindRegistryCardEvents()).
  // Each slot always shows its OWN points (never a single shared "+N each"
  // header) — every item can be priced independently by an admin at any
  // time, even if their coded defaults happen to start equal, so a shared
  // header could otherwise go stale the moment one is overridden without
  // the others (same reasoning as the built-in Pratikraman card's
  // Devasiya/Raiya split).
  _buildRegistrySlotCardHtml(entry, isExclusive) {
    const slotHtml = (item, idx) => `
      <button class="slot-btn" id="${entry.id}-opt${idx}" type="button">
        <span class="slot-icon">${item.icon || entry.icon || ''}</span>
        <span class="slot-label">${item.label}</span>
        <span class="card-kp" data-point-key="${item.pointsKey || item.prop}" data-point-format="+{n} AP">+${item.points} AP</span>
        <span class="slot-check" id="${entry.id}-opt${idx}-check">○</span>
      </button>`;
    const statusText = isExclusive ? 'None selected' : `0/${entry.items.length} completed`;
    return `
      <div class="activity-card" id="${entry.id}-card">
        <div class="lock-indicator hidden" id="${entry.id}-lock">🔒</div>
        <div class="card-header">
          <div class="card-title-area">
            <span class="card-icon">${entry.icon || ''}</span>
            <span class="card-title">${entry.label}</span>
            <span class="card-title-hindi">${entry.labelHindi || ''}</span>
          </div>
        </div>
        <div class="card-body">
          <div class="pratikraman-slots">
            ${entry.items.map(slotHtml).join('')}
          </div>
          <div class="card-status" id="${entry.id}-status">${statusText}</div>
        </div>
      </div>`;
  }

  // Binds every registry card's buttons — called once from
  // setupUserEventListeners(), after _renderRegistryCards() has built the
  // shells (see initUser()). 'simple' reuses toggleSimpleActivity() directly,
  // exactly like the built-in cards' bindSimple().
  _bindRegistryCardEvents() {
    (typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : []).forEach(entry => {
      if (!entry.flag) return;

      if (entry.layout === 'simple') {
        const item = entry.items[0];
        const btn = document.getElementById(`btn-${entry.id}`);
        const btnUndo = document.getElementById(`btn-${entry.id}-undo`);
        if (btn) btn.addEventListener('click', () => this.toggleSimpleActivity(entry.id, item.prop, true, item.prop));
        if (btnUndo) btnUndo.addEventListener('click', () => this.toggleSimpleActivity(entry.id, item.prop, false, item.prop));
      } else if (entry.layout === 'dependent') {
        const btn = document.getElementById(`btn-${entry.id}`);
        const btnUndo = document.getElementById(`btn-${entry.id}-undo`);
        const checkbox = document.getElementById(`${entry.id}-child-checkbox`);
        if (btn) btn.addEventListener('click', () => this._toggleRegistryDependentParent(entry, true));
        if (btnUndo) btnUndo.addEventListener('click', () => this._toggleRegistryDependentParent(entry, false));
        if (checkbox) checkbox.addEventListener('change', () => this._toggleRegistryDependentChild(entry));
      } else if (entry.layout === 'dual') {
        entry.items.forEach((item, idx) => {
          const slotBtn = document.getElementById(`${entry.id}-opt${idx}`);
          if (slotBtn) slotBtn.addEventListener('click', () => this._toggleRegistrySlot(entry, item));
        });
      } else if (entry.layout === 'exclusive') {
        entry.items.forEach((item, idx) => {
          const slotBtn = document.getElementById(`${entry.id}-opt${idx}`);
          if (slotBtn) slotBtn.addEventListener('click', () => this._selectRegistryExclusive(entry, item));
        });
      }
    });
  }

  // ----- 'dependent' layout handlers — generalize completePooja()/undoPooja()/
  // toggleAshtaPrakari() (parent gates the child's score, undoing the parent
  // does not clear the child's own flag — matching that exact precedent) but
  // route both through afterActivity() so the header/badges/Perfect Day stay
  // in sync on every toggle, including the child's. -----
  _toggleRegistryDependentParent(entry, isDone) {
    if (this.isDayLocked()) return;
    const [parent, child] = entry.items;
    if (this.dailyLog[parent.prop] === isDone) return;
    this.dailyLog[parent.prop] = isDone;
    const P = livePoints();
    let points = P[parent.prop];
    if (this.dailyLog[child.prop]) points += P[child.prop];
    if (isDone) {
      this.addKarmaPoints(points, entry.id);
      this.showCompletionBurst(document.getElementById(`${entry.id}-card`));
      this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;
    } else {
      this.deductKarmaPoints(points);
      if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) this.dailyLog.perfectDay = false;
    }
    this.afterActivity();
  }

  _toggleRegistryDependentChild(entry) {
    if (this.isDayLocked()) return;
    const [parent, child] = entry.items;
    const checkbox = document.getElementById(`${entry.id}-child-checkbox`);
    if (!checkbox) return;
    this.dailyLog[child.prop] = checkbox.checked;
    if (this.dailyLog[parent.prop]) {
      const childPoints = livePoints()[child.prop];
      if (this.dailyLog[child.prop]) this.addKarmaPoints(childPoints, entry.id);
      else this.deductKarmaPoints(childPoints);
    }
    this.afterActivity();
  }

  // ----- 'dual' layout handler — generalizes completePratikraman(): each
  // slot toggles independently, both required for the card to read complete. -----
  _toggleRegistrySlot(entry, item) {
    if (this.isDayLocked()) return;
    const wasDone = !!this.dailyLog[item.prop];
    this.dailyLog[item.prop] = !wasDone;
    const points = livePoints()[item.prop];
    if (!wasDone) {
      this.addKarmaPoints(points, entry.id);
      this.showCompletionBurst(document.getElementById(`${entry.id}-card`));
      this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;
    } else {
      this.deductKarmaPoints(points);
      if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) this.dailyLog.perfectDay = false;
    }
    this.afterActivity();
  }

  // ----- 'exclusive' layout handler — at most ONE of N items, never more:
  // selecting one clears every other one first. -----
  _selectRegistryExclusive(entry, chosenItem) {
    if (this.isDayLocked()) return;
    const wasChosen = !!this.dailyLog[chosenItem.prop];
    const P = livePoints();

    if (wasChosen) {
      // Clicking the already-selected option again clears it → back to "none".
      this.dailyLog[chosenItem.prop] = false;
      this.deductKarmaPoints(P[chosenItem.pointsKey || chosenItem.prop]);
    } else {
      // Clear every OTHER item that's currently selected — defensively all
      // of them, not just one, so N-way exclusivity (Tapasya's 4 levels)
      // can never leave a second option still silently scoring.
      entry.items.forEach(other => {
        if (other.prop === chosenItem.prop || !this.dailyLog[other.prop]) return;
        this.dailyLog[other.prop] = false;
        this.deductKarmaPoints(P[other.pointsKey || other.prop]);
      });
      this.dailyLog[chosenItem.prop] = true;
      this.addKarmaPoints(P[chosenItem.pointsKey || chosenItem.prop], entry.id);
      this.showCompletionBurst(document.getElementById(`${entry.id}-card`));
      this.profile.totalActivities = (this.profile.totalActivities || 0) + 1;
    }
    if (this.dailyLog.perfectDay && !this.isAllTasksComplete()) this.dailyLog.perfectDay = false;
    this.afterActivity();
  }

  // ===== EVENT LISTENERS =====
  setupUserEventListeners() {
    // `pointKey` (NOT a number) — resolved via livePoints() lazily, inside
    // toggleSimpleActivity(), on every tap. Binding the NUMBER here instead
    // would capture it by value in this closure at dashboard-init time, so
    // an admin's point-value change wouldn't take effect until reload.
    const bindSimple = (id, prop, pointKey, elId = id) => {
      const btn = document.getElementById(`btn-${elId}`);
      const btnUndo = document.getElementById(`btn-${elId}-undo`);
      if (btn) btn.addEventListener('click', () => this.toggleSimpleActivity(elId, prop, true, pointKey));
      if (btnUndo) btnUndo.addEventListener('click', () => this.toggleSimpleActivity(elId, prop, false, pointKey));
    };

    bindSimple('navkarsi', 'navkarsiDone', 'navkarsi');
    bindSimple('wakeup', 'wakeUpDone', 'wakeUpEarly');
    bindSimple('sleep', 'sleepDone', 'sleepEarly');
    bindSimple('pranam', 'pranamDone', 'pranam');
    bindSimple('ratribhojan', 'ratriBhojanDone', 'ratriBhojan');
    bindSimple('kandmool', 'kandmoolDone', 'kandmool');
    bindSimple('niyam', 'dailyNiyamDone', 'dailyNiyam');

    // Registry niyams (data.js's NIYAM_REGISTRY) — see _bindRegistryCardEvents()
    this._bindRegistryCardEvents();

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

    bindCounter('samayik', (delta) => this.adjustCounter('samayikDone', delta, 'samayik', 'samayik'));
    bindCounter('book', (delta) => this.adjustCounter('bookReadingMins', delta * 30, 'bookReading', 'book'));

    const bindScreenTime = (id, prop, delta) => {
      const btnMinus = document.getElementById(`btn-${id}-minus`);
      const btnPlus = document.getElementById(`btn-${id}-plus`);
      if (btnMinus) btnMinus.addEventListener('click', () => this.adjustScreenTime(prop, -delta));
      if (btnPlus) btnPlus.addEventListener('click', () => this.adjustScreenTime(prop, delta));
    };
    bindScreenTime('screen-h', 'screenTimeHours', 1);

    // Navigation
    document.querySelectorAll('#bottom-nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        // Pushed BEFORE switching — switchTab()'s own replaceState (which
        // keeps history.state.tab truthful for every OTHER caller) then
        // lands on the entry we're arriving at, not the one we're leaving.
        // Pushing after switching was the bug: it overwrote the PREVIOUS
        // entry's tab instead, so one back press could silently do nothing
        // and the next one skipped straight past it. Skipped for a re-tap
        // of the already-active tab so mashing one nav button doesn't pile
        // up dead entries — switchTab() still re-runs either way.
        if (this._navCurrentTab() !== tab) history.pushState({ tab, overlay: null }, '');
        this.switchTab(tab);
      });
    });

    // History month navigation
    const hPrev = document.getElementById('btn-history-prev');
    const hNext = document.getElementById('btn-history-next');
    if (hPrev) hPrev.addEventListener('click', () => this._changeHistoryMonth(-1, false));
    if (hNext) hNext.addEventListener('click', () => this._changeHistoryMonth(1, false));

    // Monthly Niyam Stats — single entry point on the History tab (the
    // Achievements tab's duplicate trigger was removed; month-scoped data
    // belongs with the other month-scoped controls).
    const btnStatsFromHistory = document.getElementById('btn-niyam-stats-history');
    if (btnStatsFromHistory) btnStatsFromHistory.addEventListener('click', () => this.openNiyamStats());
    const btnCloseNiyamStats = document.getElementById('btn-close-niyam-stats');
    if (btnCloseNiyamStats) btnCloseNiyamStats.addEventListener('click', () => this.closeNiyamStats());
    const niyamStatsPrev = document.getElementById('btn-niyam-stats-prev');
    const niyamStatsNext = document.getElementById('btn-niyam-stats-next');
    if (niyamStatsPrev) niyamStatsPrev.addEventListener('click', () => this._changeNiyamStatsMonth(-1));
    if (niyamStatsNext) niyamStatsNext.addEventListener('click', () => this._changeNiyamStatsMonth(1));

    // Multi-profile switcher bindings now live in _initProfileSwitcher(),
    // called once from the constructor — shared with the admin header's
    // avatar button, which this per-role setup function never sees.

    // Logout
    document.getElementById('btn-user-logout').addEventListener('click', () => this.openLogoutConfirm());

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
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        // A direct tap on ANY bottom-nav tab means "go there fresh" — it
        // must never leave a stale individual-user selection active
        // underneath. Without this, _navOnPopState()'s admin branch (which
        // detects a drill-down via this._adminSelectedUid, not via what's
        // in the popped entry — selectAdminUser() is the only other place
        // that flag is ever set) could misfire on a later back press and
        // redirect all the way to the Leaderboard instead of returning to
        // whichever tab was actually being backed out of.
        if (this._adminSelectedUid) this._resetAdminProgressView();
        // Pushed BEFORE switching — see the user nav handler's comment for
        // why the order matters. Skipped for a re-tap of the active tab.
        if (this._navCurrentTab() !== tab) history.pushState({ tab, overlay: null }, '');
        this.switchAdminTab(tab);
      });
    });

    // Save settings
    document.getElementById('btn-save-settings').addEventListener('click', () => this.saveAdminSettings());

    // Niyam points/toggle merged rows — delegated on the whole tab since the
    // registry rows are generated later by _renderAdminNiyamRows() and a
    // per-checkbox listener would miss them. Also marks the tab dirty (see
    // loadAdminSettingsUI()'s guard) — a toggle flip must survive a
    // listener repaint racing in before Save is pressed, exactly like an
    // in-progress points edit does via the input listener just below.
    const settingsTabEl = document.getElementById('admin-tab-settings');
    if (settingsTabEl) settingsTabEl.addEventListener('change', (e) => {
      if (e.target && e.target.matches('input[type="checkbox"][id^="admin-toggle-"]')) {
        this._adminSettingsDirty = true;
        this._syncNiyamRowStates();
      }
    });
    // Points inputs use 'input' (fires per keystroke), not 'change' (fires
    // only on blur) — an admin who types a value and hits Save without
    // ever blurring the field must still be protected from a repaint
    // wiping it mid-edit.
    if (settingsTabEl) settingsTabEl.addEventListener('input', (e) => {
      if (e.target && e.target.matches('input[type="number"][id^="admin-points-"]')) {
        this._adminSettingsDirty = true;
      }
    });

    // Repaints the whole tab (toggles + points, not just points) when a
    // multi-sangh admin switches which sangh they're editing — without
    // this, switching the dropdown left the PREVIOUS sangh's values on
    // screen, and saving then wrote them onto the newly-selected sangh.
    // Explicitly clears the dirty flag first — switching sangh means the
    // admin is intentionally abandoning any in-progress edit on the sangh
    // they're leaving, so the guard that protects a mid-edit must not also
    // block this deliberate repaint.
    const pointsSanghEl = document.getElementById('admin-points-sangh');
    if (pointsSanghEl) pointsSanghEl.addEventListener('change', () => {
      this._adminSettingsDirty = false;
      this.loadAdminSettingsUI();
    });

    // Unlock (now lives in the member drill-down, not a dedicated tab)
    const btnUnlockDay = document.getElementById('btn-unlock-day');
    if (btnUnlockDay) btnUnlockDay.addEventListener('click', () => this.adminUnlockDay());

    // Reset (Danger Zone, also relocated into the member drill-down)
    const btnAdminReset = document.getElementById('btn-admin-reset');
    if (btnAdminReset) btnAdminReset.addEventListener('click', () => this.resetProgress());

    // Logout
    document.getElementById('btn-admin-logout').addEventListener('click', () => this.openLogoutConfirm());

    // Back to leaderboard — goes through history.back() rather than calling
    // _showAdminOverview() directly, so the button and the device back
    // button are the exact same code path (_navOnPopState()'s admin
    // branch) and can never drift apart. Consumes the history entry
    // selectAdminUser() pushed when this user was first opened.
    const backBtn = document.getElementById('btn-back-leaderboard');
    if (backBtn) backBtn.addEventListener('click', () => history.back());

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

    // Leaderboard search
    const leaderboardSearchEl = document.getElementById('leaderboard-search');
    if (leaderboardSearchEl) leaderboardSearchEl.addEventListener('input', () => this._filterLeaderboard());

    // Manual leaderboard refresh — see _fetchAdminUsers()'s comment on why
    // there is no live listener any more (switchAdminTab() already refetches
    // on every visit to this tab; this covers "I want it current right now"
    // without needing a tab switch).
    const refreshLeaderboardBtn = document.getElementById('btn-refresh-leaderboard');
    if (refreshLeaderboardBtn) refreshLeaderboardBtn.addEventListener('click', () => this.renderAdminLeaderboard());

    // Export leaderboard to Excel
    const openExportBtn = document.getElementById('btn-open-export');
    if (openExportBtn) openExportBtn.addEventListener('click', () => this.openExportDialog());
    const cancelExportBtn = document.getElementById('btn-cancel-export');
    if (cancelExportBtn) cancelExportBtn.addEventListener('click', () => this.closeExportDialog());
    const runExportBtn = document.getElementById('btn-run-export');
    if (runExportBtn) runExportBtn.addEventListener('click', () => this.runExport());

    // Leaderboard poster
    const openPosterBtn = document.getElementById('btn-open-poster');
    if (openPosterBtn) openPosterBtn.addEventListener('click', () => this.openPosterOverlay());
    const closePosterBtn = document.getElementById('btn-close-poster');
    if (closePosterBtn) closePosterBtn.addEventListener('click', () => this.closePosterOverlay());
    const posterPrevBtn = document.getElementById('btn-poster-prev');
    if (posterPrevBtn) posterPrevBtn.addEventListener('click', () => this._changePosterMonth(-1));
    const posterNextBtn = document.getElementById('btn-poster-next');
    if (posterNextBtn) posterNextBtn.addEventListener('click', () => this._changePosterMonth(1));
    const downloadPosterBtn = document.getElementById('btn-download-poster');
    if (downloadPosterBtn) downloadPosterBtn.addEventListener('click', () => this._downloadPoster());
    const sharePosterBtn = document.getElementById('btn-share-poster');
    if (sharePosterBtn) sharePosterBtn.addEventListener('click', () => this._sharePoster());

    // Attendance
    const attendanceDateEl = document.getElementById('attendance-date');
    if (attendanceDateEl) {
      attendanceDateEl.addEventListener('change', () => {
        if (this._attendanceDirty) {
          if (!confirm("You have unsaved attendance changes. Discard them and switch dates?")) {
            attendanceDateEl.value = this._attendanceDate || this.getTodayKey();
            return;
          }
        }
        this.renderAttendance();
      });
    }
    const attendanceSearchEl = document.getElementById('attendance-search');
    if (attendanceSearchEl) attendanceSearchEl.addEventListener('input', () => this._filterAttendance());
    const markAllPresentBtn = document.getElementById('btn-attendance-mark-all');
    if (markAllPresentBtn) markAllPresentBtn.addEventListener('click', () => this._markAllAttendancePresent());
    const saveAttendanceBtn = document.getElementById('btn-save-attendance');
    if (saveAttendanceBtn) saveAttendanceBtn.addEventListener('click', () => this.saveAttendance());
    // Delegated so a single binding survives every re-render of
    // #attendance-list's innerHTML (per-row listeners would otherwise need
    // re-attaching on every renderAttendance() call).
    const attendanceListEl = document.getElementById('attendance-list');
    if (attendanceListEl) {
      attendanceListEl.addEventListener('change', (e) => {
        const cb = e.target.closest('.attendance-present-checkbox');
        if (!cb) return;
        const uid = cb.dataset.uid;
        this._getOrInitAttendanceDraft(uid).present = cb.checked;
        this._markAttendanceDirty();
        const row = cb.closest('.attendance-row');
        if (row) row.classList.toggle('is-absent', !cb.checked);
      });
      attendanceListEl.addEventListener('click', (e) => {
        const minus = e.target.closest('.attendance-gatha-minus');
        const plus = e.target.closest('.attendance-gatha-plus');
        if (!minus && !plus) return;
        const uid = (minus || plus).dataset.uid;
        const valEl = attendanceListEl.querySelector(`.attendance-gatha-val[data-uid="${uid}"]`);
        if (!valEl) return;
        let val = parseInt(valEl.textContent, 10) || 0;
        val = minus ? Math.max(0, val - 1) : val + 1;
        valEl.textContent = val;
        this._getOrInitAttendanceDraft(uid).gathas = val;
        this._markAttendanceDirty();
      });
    }

    // Export attendance to Excel
    const openAttendanceExportBtn = document.getElementById('btn-open-attendance-export');
    if (openAttendanceExportBtn) openAttendanceExportBtn.addEventListener('click', () => this.openAttendanceExportDialog());
    const cancelAttendanceExportBtn = document.getElementById('btn-cancel-attendance-export');
    if (cancelAttendanceExportBtn) cancelAttendanceExportBtn.addEventListener('click', () => this.closeAttendanceExportDialog());
    const runAttendanceExportBtn = document.getElementById('btn-run-attendance-export');
    if (runAttendanceExportBtn) runAttendanceExportBtn.addEventListener('click', () => this.runAttendanceExport());
  }

  // ===== FIREBASE SYNC & REALTIME LISTENERS =====
  listenToRef(path, callback) {
    if (!this._activeListeners) this._activeListeners = [];
    return new Promise((resolve, reject) => {
      let settled = false;
      const ref = db.ref(path);
      const listener = ref.on('value', snap => {
        callback(snap.val());
        if (!settled) {
          settled = true;
          resolve();
        }
      }, err => {
        // Firebase's error callback — fires on permission_denied or a ref
        // that can never be read. Without this, a denied/unreachable ref
        // never calls back at all, so the promise this method returns would
        // hang forever, stalling setupRealtimeSync()'s Promise.all
        // indefinitely and leaving the app on a permanently blank screen.
        console.error(`Firebase read failed for "${path}":`, err);
        if (!settled) {
          settled = true;
          reject(err);
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

    // v5 has no legacy global `settings` node to listen to any more — a
    // member's settings resolve purely from their own sangh's
    // sangh_config/{code} (the p5 listener below); there is no middle
    // fallback layer left (see resolveSettings()).
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
          this._renderAdminUnlockButton();
        } else {
          this.renderDashboard();
        }
      }
    });

    // Listen to ALL daily_logs (real-time). Admin's History tab always
    // relied on this; users now need it too, for monthly AP in the header
    // and the lifetime stats grid (Badges tab) — neither is derivable from
    // the single per-day counters in profile. Deliberately not part of the
    // awaited settle below (see _resetAdminUserState()'s comment on
    // _cachedDailyLogs) — both roles render an initial frame without it,
    // then refresh the instant this first resolves. Needs its own .catch()
    // since listenToRef() can now reject (see its error callback) — without
    // one, a denied read here would be an unhandled rejection instead of a
    // logged error.
    this.listenToRef(`${userPath}/daily_logs`, val => {
      this._cachedDailyLogs = val || {};
      if (!this.initializing) {
        if (this.currentRole === 'admin') {
          this.renderAdminHistory();
          // Re-render open day detail modal if visible
          if (this._openDayDetailKey) this.showDayDetail(this._openDayDetailKey);
        } else {
          this.renderHeader();
          this.renderAchievements();
        }
      }
    }).catch(e => console.error('daily_logs (all) listener failed:', e));

    // Attendance — user-facing "My Attendance" (History tab). Supplementary
    // like daily_logs just above: deliberately NOT part of the awaited
    // settle, so a denied/slow read here can never block first paint and
    // can never raise the "your niyams may not save" banner (that list is
    // built only from the critical listeners below). Own .catch() for the
    // same reason as daily_logs — otherwise a rejection here would be an
    // unhandled rejection instead of a logged, swallowed error.
    this.listenToRef(`${userPath}/attendance`, val => {
      this._cachedAttendance = val || {};
      if (!this.initializing && this.currentRole === 'user') this.renderMyAttendance();
    }).catch(e => console.error('attendance listener failed:', e));

    const p4 = this.listenToRef(`${userPath}/lock_status/${todayKey}`, val => {
      this.currentDayLocked = !!val;
      this.currentDayLockValue = val;
      if (!this.initializing) {
        if (this.currentRole === 'user') this.updateLockUI();
        else if (this.currentRole === 'admin') this._renderAdminUnlockButton();
      }
    });

    // Per-sangh niyam settings + point overrides — user sessions only (the
    // admin's OWN role never scores anything; a family profile switched
    // INTO always goes through this same initUser()/setupRealtimeSync()
    // path as its own uid, so it resolves its own sangh's config
    // correctly regardless). Must resolve before _migrateToRawPoints()
    // runs (see initUser()'s ordering comment) — it's included in the same
    // awaited settle below as everything else, so that ordering is
    // guaranteed. Reads registration.sanghCode directly (rather than
    // this._currentAuthUser.sanghCodes[0], the field meant for a
    // multi-sangh ADMIN's managed list) — this is the single source of
    // truth for which sangh an ordinary member belongs to; see
    // deleteAdminUser()/_confirmSanghReselect() for the same choice
    // elsewhere.
    let p5 = Promise.resolve();
    const labeledPaths = [`${userPath}/profile`, `${userPath}/daily_logs/${todayKey}`, `${userPath}/lock_status/${todayKey}`];
    if (this.currentRole === 'user') {
      const sanghCode = (this._currentAuthUser && this._currentAuthUser.profile && this._currentAuthUser.profile.sanghCode) || null;
      if (sanghCode) {
        p5 = this.listenToRef(`sangh_config/${sanghCode}`, val => {
          setLivePoints(resolvePointMap(val && val.points));
          this._sanghPointsVersion = (val && val.pointsVersion) || 0;
          // Cache the raw node's `settings` child too, and re-resolve
          // this.settings (see resolveSettings()) — this sangh's own saved
          // config is now the ONLY layer besides DEFAULT_SETTINGS.
          this._sanghSettingsNode = val;
          this.settings = resolveSettings(this._sanghSettingsNode);
          // renderDashboard() itself calls _refreshPointLabels() — no need
          // to call it separately here.
          if (!this.initializing) this.renderDashboard();
        });
        labeledPaths.push(`sangh_config/${sanghCode}`);

        // sangh_attendance/{code} — the roster-level "which dates did the
        // class meet" record (see saveAttendance()/_extractTakenDates()).
        // A SEPARATE listener from sangh_config above (v4 kept this data
        // nested inside the settings node, so it was re-downloaded on
        // every points/toggle change too) — supplementary like the
        // daily_logs/attendance listeners just above: not part of the
        // awaited critical settle, own .catch(), never blocks first paint.
        this.listenToRef(`sangh_attendance/${sanghCode}`, val => {
          this._sanghAttendanceNode = val || null;
          if (!this.initializing && this.currentRole === 'user') {
            this.renderMyAttendance();
            this.renderAchievements();
          }
        }).catch(e => console.error('sangh_attendance listener failed:', e));
      }
    }

    // allSettled (not all) so one denied/unreachable ref can never hang
    // initialisation — every caller gets to reveal *something* regardless
    // of what Firebase's rules allow. Returns the paths that failed so the
    // caller can tell the user their data may not be syncing.
    const results = await Promise.allSettled([p2, p3, p4, p5]);
    return results
      .map((r, i) => (r.status === 'rejected' ? labeledPaths[i] : null))
      .filter(Boolean);
  }

  saveProfile() { db.ref(`users/${this.uid}/profile`).set(this.profile); }
  saveDailyLogFor(dateKey, log) {
    db.ref(`users/${this.uid}/daily_logs/${dateKey}`).set(log);
  }
  saveDailyLog() {
    this.saveDailyLogFor(this.getTodayKey(), this.dailyLog);
  }

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

  // Editable window: yesterday back through 30 days ago. Today is
  // deliberately excluded — it's edited live via the dashboard, not this
  // overlay. The 3-per-month streak-saver cap (STREAK_SAVERS_PER_MONTH,
  // _streakSaversLeft()) is unaffected by this window — it still limits
  // HOW MANY days can be edited, this only widens WHICH days are eligible.
  // Date keys are YYYY-MM-DD, so lexicographic comparison sorts identically
  // to chronological order and safely spans month boundaries.
  _isStreakSaverEligible(dateKey) {
    return dateKey >= this.getTodayKey(-30) && dateKey < this.getTodayKey();
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

  startAutoLockCheck() {
    // Check every 30 seconds if we crossed midnight
    this.autoLockInterval = setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        // Midnight — checkDailyReset() finalizes + locks the previous day and rolls
        // over to today; it is the single owner of back-locking.
        await this.checkDailyReset();
        this.renderDashboard();
        this.calculatePanchang().catch(e => console.error('Panchang render failed:', e)); // roll the panchang card to the new day too
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
      'ratribhojan', 'kandmool', 'screentime', 'niyam',
      ...(typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY.filter(e => e.flag).map(e => e.id) : []),
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
    // Snapshot exactly what updateStreak()/the perfect-day counter are about
    // to change, so an admin unlock can revert this finalization precisely —
    // an increment and a reset-to-0 are otherwise indistinguishable after
    // the fact.
    this.dailyLog.finalizeSnapshot = {
      currentStreak: this.profile.currentStreak,
      longestStreak: this.profile.longestStreak,
      totalPerfectDays: this.profile.totalPerfectDays || 0,
      streakFreezeUsed: !!this.profile.streakFreezeUsed,
      streakFreezeMonth: this.profile.streakFreezeMonth || null,
      perfectDay: !!this.dailyLog.perfectDay,
    };
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
        now, cached.timezone
      );
      return;
    }

    // Render the local calculation immediately — the card must never be
    // blank or stalled on a network round trip.
    const local = SunTimes.sunTimesFor(loc.lat, loc.lng, loc.elevation, now, loc.timezone);
    this.renderPanchang(local, now, loc.timezone);

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

      this.renderPanchang(sunTimes, now, timezone);
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

  // ===== RENDERING =====
  // Every write here is independently null-guarded, including ones that
  // "should" always exist — a commented-out row (like #tithi-value used to
  // be) must degrade that one line, never abort the whole function and
  // strand the rest of the card. See renderHeader()'s identical pattern and
  // its comment on the streak markup outage this mirrors.
  renderPanchang(sunTimes, now, timezone) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateEl = document.getElementById('panchang-date');
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-IN', options);

    const sunriseEl = document.getElementById('sunrise-time');
    const navkarsiEl = document.getElementById('navkarsi-time');
    const sunsetEl = document.getElementById('sunset-time');

    if (sunTimes && sunTimes.sunrise) {
      const navkarsi = new Date(sunTimes.sunrise.getTime() + 48 * 60000);
      if (sunriseEl) sunriseEl.textContent = this._formatClockTime(sunTimes.sunrise, timezone);
      if (navkarsiEl) navkarsiEl.textContent = this._formatClockTime(navkarsi, timezone);
    } else {
      if (sunriseEl) sunriseEl.textContent = '--:--';
      if (navkarsiEl) navkarsiEl.textContent = '--:--';
    }

    if (sunTimes && sunTimes.sunset) {
      if (sunsetEl) sunsetEl.textContent = this._formatClockTime(sunTimes.sunset, timezone);
    } else {
      if (sunsetEl) sunsetEl.textContent = '--:--';
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

  // Repaints every element carrying data-point-key — the 14 hardcoded
  // "+N AP" labels in index.html (one per built-in niyam) PLUS every
  // registry card's own points label (_buildRegistry*CardHtml() tags them
  // the same way) — from this session's live point map. `{n}` inside
  // data-point-format is the one substituted placeholder; everything else
  // in the format string (icon-less labels, "Ashta (+{n})", "-{n}/hr", …)
  // is preserved verbatim. A key with no live value (shouldn't happen —
  // DEFAULT_POINT_MAP always covers every tagged key — but defensive
  // regardless) simply leaves that label unchanged rather than writing
  // "undefined".
  _refreshPointLabels() {
    const P = livePoints();
    document.querySelectorAll('[data-point-key]').forEach(el => {
      const val = P[el.dataset.pointKey];
      if (typeof val !== 'number') return;
      const format = el.dataset.pointFormat || '+{n} AP';
      el.textContent = format.replace('{n}', val);
    });
  }

  // Populates every hand-written card / admin row from NIYAM_REGISTRY, so a
  // built-in's name, Hindi or icon is edited in data.js alone and shows up
  // everywhere at once. Exactly the mechanism _refreshPointLabels() above
  // already uses for point values, just for text:
  //
  //   data-niyam-label="pooja"        -> that entry's label
  //   data-niyam-label="pooja:admin"  -> its adminLabel (falls back to label)
  //   data-niyam-hindi="pooja"        -> its labelHindi
  //   data-niyam-icon="pooja"         -> its icon
  //
  // Generated cards and admin rows already interpolate the same values at
  // build time, so they need no attributes. Every lookup is guarded: an
  // attribute naming an entry that no longer exists simply leaves the
  // markup's own text in place rather than blanking it or throwing.
  _refreshNiyamLabels() {
    const REGISTRY = typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : [];
    if (!REGISTRY.length) return;
    const byId = {};
    REGISTRY.forEach(e => { byId[e.id] = e; });

    // Reference syntax: "<id>[#itemIndex][:variant]"
    //   pooja          -> the entry
    //   pooja:admin    -> the entry, admin wording
    //   pooja#1        -> its second item (the Ashta Prakari sub-row)
    // data-niyam-prefix, if present, is kept in front of the resolved text
    // so a sub-row's "↳ " indent marker survives the repaint.
    const resolve = raw => {
      const [head, variant] = raw.split(':');
      const [id, itemIdx] = head.split('#');
      const entry = byId[id];
      if (!entry) return null;
      if (itemIdx === undefined) return { entry, target: entry, variant };
      const item = (entry.items || [])[Number(itemIdx)];
      return item ? { entry, target: item, variant } : null;
    };

    const apply = (selector, datasetKey, pick) => {
      document.querySelectorAll(selector).forEach(el => {
        const raw = el.dataset[datasetKey];
        if (!raw) return;
        const found = resolve(raw);
        if (!found) return; // stale reference — leave the markup's own text alone
        const text = pick(found.target, found.entry, found.variant);
        if (typeof text !== 'string' || !text) return;
        el.textContent = (el.dataset.niyamPrefix || '') + text;
      });
    };

    // adminLabel / adminLabelHindi only exist on entries and only where the
    // Settings row legitimately reads differently from the dashboard card
    // (e.g. the Pratikraman row names the Devasiya slot its points input
    // belongs to). Everything else falls back to the single shared value.
    apply('[data-niyam-label]', 'niyamLabel',
      (t, e, variant) => (variant === 'admin' ? (t.adminLabel || t.label) : t.label));
    apply('[data-niyam-hindi]', 'niyamHindi',
      (t, e, variant) => (variant === 'admin' ? (t.adminLabelHindi || t.labelHindi) : t.labelHindi));
    apply('[data-niyam-icon]', 'niyamIcon', (t, e) => t.icon || e.icon);
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
    this._refreshPointLabels();
    this._refreshNiyamLabels();
  }

  // Today's AP, read straight from `this.dailyLog` — the live in-memory log
  // that every activity handler mutates, so the header updates instantly on
  // each toggle rather than waiting on the daily_logs listener's round trip.
  // Uses the stored `kpEarned` (not a recompute) so it always matches what
  // today's History card shows. Null-safe for the very first render, before
  // the listener has assigned a log.
  _computeDailyAP() {
    return (this.dailyLog && this.dailyLog.kpEarned) || 0;
  }

  renderHeader() {
    const kpEl = document.getElementById('karma-points');
    if (kpEl) kpEl.textContent = `${this._computeDailyAP()} AP`;

    // The streak display is currently commented out of index.html, so these
    // are null. Every write must stay guarded: unguarded, this threw and
    // aborted renderDashboard() → initUser() before setupUserEventListeners()
    // ever ran, which is why not a single dashboard button responded.
    const countEl = document.getElementById('streak-count');
    const flameEl = document.getElementById('streak-flame');
    if (!countEl && !flameEl) return;

    const s = (this.profile && this.profile.currentStreak) || 0;
    if (countEl) countEl.textContent = s;
    if (flameEl) {
      if (s >= 30) flameEl.textContent = '✨🔥✨';
      else if (s >= 14) flameEl.textContent = '🔥🔥🔥';
      else if (s >= 7) flameEl.textContent = '🔥🔥';
      else if (s >= 3) flameEl.textContent = '🔥';
      else flameEl.textContent = '🕯️';
    }
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
    const REGISTRY = typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : [];
    checkCat('cat-bhakti', REGISTRY.filter(e => e.flag && e.section === 'bhakti').map(e => s[e.flag]));
    checkCat('cat-aachar', REGISTRY.filter(e => e.flag && e.section === 'aachar').map(e => s[e.flag]));

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

      // Raiya has its own sub-flag (see registerNiyams()'s reasoning) —
      // hide the evening slot independently of the parent Pratikraman
      // toggle, and size "X/N completed" to whichever slots are actually
      // showing so it never gets stuck reading "…/2" with only one slot on
      // screen.
      if (btnEvening) btnEvening.style.display = s.enableRaiya ? '' : 'none';
      if (s.enableRaiya) {
        if (btnEvening) {
          if (d.raiyaDone) btnEvening.classList.add('done');
          else btnEvening.classList.remove('done');
          btnEvening.disabled = locked;
        }
        if (checkEvening) checkEvening.textContent = d.raiyaDone ? '●' : '○';
      }

      const pSlotTotal = 1 + (s.enableRaiya ? 1 : 0);
      const pCount = (d.devasiyaDone ? 1 : 0) + (s.enableRaiya && d.raiyaDone ? 1 : 0);
      if (pStatus) pStatus.textContent = `${pCount}/${pSlotTotal} completed`;
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
    // Ashta Prakari has its own sub-flag — hide the whole toggle (checkbox
    // + its points label) independently of the parent Jin Pooja toggle.
    const ashtaToggle = ashtaCheck && ashtaCheck.closest('.ashta-toggle');
    if (ashtaToggle) ashtaToggle.style.display = s.enableAshtaPrakari ? '' : 'none';
    if (ashtaCheck && s.enableAshtaPrakari) {
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

    // ----- Registry niyams (data.js's NIYAM_REGISTRY) -----
    // Only ever updates state on the shells _renderRegistryCards() already
    // built (see initUser()) — never rebuilds them, so the listeners bound
    // in _bindRegistryCardEvents() are never lost. Reuses updateSimpleCard()
    // above by closure for 'simple' and the parent half of 'dependent',
    // exactly like the built-in cards.
    REGISTRY.forEach(entry => {
      if (!entry.flag) return;
      // Built-in cards keep their own hand-written update paths above (they
      // have bespoke counters, slot buttons and steppers this generic pass
      // can't drive) — touching them here would fight those.
      if (entry.builtIn) return;
      const card = document.getElementById(`${entry.id}-card`);
      if (!card) return;
      const enabled = !!s[entry.flag];
      card.style.display = enabled ? (entry.layout === 'simple' || entry.layout === 'dependent' ? 'flex' : 'block') : 'none';
      if (!enabled) return;

      if (entry.layout === 'simple') {
        updateSimpleCard(entry.id, !!d[entry.items[0].prop]);
      } else if (entry.layout === 'dependent') {
        const [parent, child] = entry.items;
        updateSimpleCard(entry.id, !!d[parent.prop]);
        const checkbox = document.getElementById(`${entry.id}-child-checkbox`);
        // The child can carry its own sub-flag (registerNiyams()) — hide
        // its toggle independently of the parent, same as the built-in
        // Ashta Prakari/Jin Pooja pair.
        const childEnabled = !child.flag || s[child.flag];
        const childToggle = checkbox && checkbox.closest('.ashta-toggle');
        if (childToggle) childToggle.style.display = childEnabled ? '' : 'none';
        if (checkbox && childEnabled) {
          checkbox.checked = !!d[child.prop];
          checkbox.disabled = locked;
        }
      } else {
        // 'dual' and 'exclusive' — two independent slot buttons. A sub-
        // item's own flag can hide its slot independently of the parent —
        // mirrors the built-in Pratikraman card's Raiya handling, and
        // "X/N completed" counts only the slots actually showing so it
        // never gets stuck reading "…/2" with one slot hidden.
        let doneCount = 0;
        let doneItem = null;
        let enabledCount = 0;
        entry.items.forEach((item, idx) => {
          const itemEnabled = !item.flag || s[item.flag];
          const slotBtn = document.getElementById(`${entry.id}-opt${idx}`);
          if (slotBtn) slotBtn.style.display = itemEnabled ? '' : 'none';
          if (!itemEnabled) return;
          enabledCount++;
          const isDone = !!d[item.prop];
          if (isDone) { doneCount++; doneItem = item; }
          if (slotBtn) {
            slotBtn.classList.toggle('done', isDone);
            slotBtn.disabled = locked;
          }
          const check = document.getElementById(`${entry.id}-opt${idx}-check`);
          if (check) check.textContent = isDone ? '●' : '○';
        });
        const statusEl = document.getElementById(`${entry.id}-status`);
        if (statusEl) {
          statusEl.textContent = entry.layout === 'exclusive'
            ? (doneItem ? `${doneItem.label} selected` : 'None selected')
            : `${doneCount}/${enabledCount} completed`;
        }
        card.classList.toggle('completed', doneCount > 0);
      }
    });
  }

  // Single source of truth for how much registry niyams (data.js's
  // NIYAM_REGISTRY) contribute to "total tasks" / "completed tasks" for a
  // given log — shared by getTotalTasksCount(), getCompletedCount(),
  // _isLogComplete() and the History tab's per-day cards, so all four can
  // never disagree about what counts. A 'dependent' layout's child (e.g.
  // Chaitya Vandan) never gates completion on its own, exactly like the
  // built-in Ashta Prakari never has — only the parent counts. An
  // 'exclusive' pair (e.g. Guru Vandan) counts as a single task, satisfied
  // by either option.
  // Is this ONE item satisfied for the given log? The single definition of
  // "done" per item type, shared by _registryProgress() (and therefore by
  // getTotalTasksCount()/getCompletedCount()/_isLogComplete()) so the
  // dashboard counter, Perfect Day and the streak can never disagree.
  // Mirrors each type's countsDay() in NIYAM_STATS (registerNiyams()).
  _niyamItemSatisfied(item, log, settings) {
    const d = log || {}, s = settings || DEFAULT_SETTINGS;
    const type = item.type || 'toggle';
    if (type === 'counter') {
      // targetSetting lets an admin raise the bar (Samayik's samayikTarget);
      // without one, any count of 1+ satisfies it.
      const target = parseInt((item.targetSetting && s[item.targetSetting]) || 1, 10);
      return (d[item.prop] || 0) >= target;
    }
    if (type === 'duration') return (d[item.prop] || 0) >= item.divisor;
    if (type === 'screentime') return false; // a penalty is never "done"
    return !!d[item.prop] && (!item.dependsOn || !!d[item.dependsOn]);
  }

  _registryProgress(log, settings) {
    const s = settings || DEFAULT_SETTINGS, d = log || {};
    let total = 0, completed = 0;
    (typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : []).forEach(entry => {
      if (!entry.flag || !s[entry.flag]) return;
      if (entry.layout === 'exclusive') {
        // A disabled option's own button is already hidden (dashboard
        // gating in renderActivities()), so `some(...)` can only ever see
        // the enabled option(s) in practice — no extra check needed here
        // for the pair to still count as one satisfiable task.
        total++;
        if (entry.items.some(item => !!d[item.prop])) completed++;
        return;
      }
      entry.items.forEach(item => {
        // A dependent child (Ashta Prakari, Chaitya Vandan) is a bonus on
        // top of its parent, never a task in its own right.
        if (item.dependsOn) return;
        // A second item can carry its own independent flag (Raiya, Navkar
        // Jaap — Night) — skip it from the total entirely when switched
        // off, so disabling it can never make Perfect Day unreachable.
        if (item.flag && !s[item.flag]) return;
        // Screen Time is a penalty, not something to complete — it has
        // never counted toward the daily total.
        if ((item.type || 'toggle') === 'screentime') return;
        total++;
        if (this._niyamItemSatisfied(item, d, s)) completed++;
      });
    });
    return { total, completed };
  }

  // Icons for whichever registry niyams were actually done on a given log —
  // used by the History tab's per-day icon summary. Mirrors
  // _registryProgress()'s dependency guard (a 'dependent' child only shows
  // its icon while its parent is also done) but, unlike that total/completed
  // count, every done item gets an icon here, including 'exclusive' options
  // and 'dependent' children — this is a "what happened" summary, not a
  // completion gate.
  _registryIcons(log, settings) {
    const s = settings || DEFAULT_SETTINGS, d = log || {};
    const icons = [];
    (typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : []).forEach(entry => {
      if (!entry.flag || !s[entry.flag]) return;
      entry.items.forEach(item => {
        // A sub-item switched off isn't part of this sangh's day at all.
        if (item.flag && !s[item.flag]) return;
        // Screen Time is a penalty — an icon here reads as an achievement.
        if ((item.type || 'toggle') === 'screentime') return;
        // A dependent child only shows once its parent is also done.
        if (item.dependsOn && !d[item.dependsOn]) return;
        // Uses the same "done" rule as the counters (a 29-minute read must
        // not earn the Book Reading icon when 30 is the bar) rather than a
        // bare truthiness check.
        if (this._niyamItemSatisfied(item, d, s)) icons.push(item.icon || entry.icon || '');
      });
    });
    return icons;
  }

  getTotalTasksCount() {
    // Every niyam now comes from NIYAM_REGISTRY via _registryProgress() —
    // the built-ins included. They used to be counted by a hand-written
    // branch per niyam here AND (once consolidated) again by the registry
    // walk, which double-counted every one of them and made Perfect Day
    // unreachable. One source, counted once.
    return this._registryProgress(this.dailyLog, this.settings).total;
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

  toggleSimpleActivity(elId, prop, isDone, pointKey) {
    if (this.isDayLocked()) return;
    if (this.dailyLog[prop] === isDone) return;
    this.dailyLog[prop] = isDone;
    const points = livePoints()[pointKey];

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
    const prop = slot === 'morning' ? 'devasiyaDone' : 'raiyaDone';
    const statKey = slot === 'morning' ? 'totalDevasiya' : 'totalRaysiya';
    const wasDone = !!this.dailyLog[prop];
    this.dailyLog[prop] = !wasDone;
    // Each slot is priced independently (RAW_POINT_RULES gives Raiya its
    // OWN key rather than reusing Devasiya's) so an admin can set them
    // differently — this used to always price both off POINTS.devasiya,
    // which happened to agree with RAW_POINT_RULES only because the two
    // coded defaults were equal.
    const pts = livePoints()[slot === 'morning' ? 'devasiya' : 'raiya'];

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
    const P = livePoints();
    let points = P.pooja;
    if (this.dailyLog.ashtaPrakariDone) points += P.ashtaPrakari;
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
    const P = livePoints();
    let points = P.pooja;
    if (this.dailyLog.ashtaPrakariDone) points += P.ashtaPrakari;
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
        this.addKarmaPoints(livePoints().ashtaPrakari, 'Ashta Prakari');
      } else {
        this.deductKarmaPoints(livePoints().ashtaPrakari);
      }
    }
    this.saveDailyLog();
  }

  adjustCounter(prop, delta, pointKey, elId) {
    if (this.isDayLocked()) return;
    const oldVal = this.dailyLog[prop] || 0;
    const newVal = Math.max(0, oldVal + delta);
    if (oldVal === newVal) return;
    this.dailyLog[prop] = newVal;

    const points = livePoints()[pointKey];

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
      this.deductKarmaPoints(diff * livePoints().screenTimePenalty);
    } else if (hoursNew < hoursOld) {
      const diff = hoursOld - hoursNew;
      this.addKarmaPoints(diff * livePoints().screenTimePenalty, 'Screen Time Reverted');
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
    // "Every enabled task satisfied" — _registryProgress() already applies
    // each item type's own rule (a counter must reach its target, a
    // duration its divisor), so there is nothing left to special-case here.
    const rp = this._registryProgress(log, settings || DEFAULT_SETTINGS);
    return rp.completed >= rp.total;
  }

  getCompletedCount() {
    return this._registryProgress(this.dailyLog, this.settings).completed;
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
    this._renderLifetimeStats(document.getElementById('stats-grid'));

    const badgesGrid = document.getElementById('badges-grid');
    badgesGrid.innerHTML = '';
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
      badgesGrid.appendChild(item);
    }
  }

  // Shared by the user's Badges tab and the admin's History section so the
  // two can never disagree. Summary tiles come from `profile` (already
  // lifetime-tracked); per-niyam tiles are computed fresh over the full
  // daily_logs history via _computeNiyamRange() — most niyams have no
  // profile counter at all, and the few that do can drift from a
  // streak-saver edit. Renders only into gridEl; caller owns visibility.
  // `settingsOverride`/`attendance`/`takenDates` (all optional) mirror
  // _renderHistoryDays()'s pattern — an admin drill-down passes the
  // specific member's own resolved settings, attendance record and taken-
  // dates set (see _takenDatesForMember()); the user-side call
  // (renderAchievements()) omits all three and falls back to this
  // session's own cached values. `attendance` is checked against
  // `undefined` specifically (not falsy) — a member with zero attendance
  // records legitimately passes `null`, which must NOT fall back to the
  // ADMIN's own cached attendance.
  _renderLifetimeStats(gridEl, settingsOverride, attendance, takenDates) {
    if (!gridEl) return;
    const p = this.profile || DEFAULT_PROFILE;
    const s = settingsOverride || this.settings || DEFAULT_SETTINGS;
    const logs = this._cachedDailyLogs || {};
    const today = this.getTodayKey();
    const att = attendance !== undefined ? attendance : this._cachedAttendance;
    const taken = takenDates !== undefined ? takenDates : this._extractTakenDates(this._sanghAttendanceNode, '0000-00-00', today);

    // '0000-00-00' sorts before every real date key, so this covers the
    // user's entire history without needing their actual first log date.
    const { stats } = this._computeNiyamRange(logs, '0000-00-00', today, s, true);
    const attSummary = this._summarizeAttendance(att, '0000-00-00', today, taken);

    const tiles = [
      { value: p.totalKP || 0, label: 'Total AP' },
      { value: p.longestStreak || 0, label: 'Best Streak' },
      { value: p.totalPerfectDays || 0, label: 'Perfect Days' },
      { value: attSummary.daysPresent, label: '📋 Days Present' },
      { value: attSummary.totalGathas, label: '📿 Total Gathas' },
      ...stats.map(st => ({
        value: st.amount != null ? (st.formatAmount ? st.formatAmount(st.amount) : st.amount) : st.days,
        label: `${st.icon} ${st.label}`,
      })),
    ];

    gridEl.innerHTML = tiles
      .map(t => `<div class="stat-item"><span class="stat-value">${t.value}</span><span class="stat-label">${t.label}</span></div>`)
      .join('');
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

    this.renderMyAttendance();
  }

  // Renders "My Attendance", the section below the progress list on the
  // History tab. Deliberately shares _historyYear/_historyMonth (the SAME
  // state the progress list above uses) rather than getting its own month
  // stepper, so the two sections can never disagree on which month is
  // shown — called both from renderHistory() (tab open, month change) and
  // from the attendance listener in setupRealtimeSync() (live updates).
  // A no-op if the containers aren't in the DOM (they always are inside
  // #app, so this is really just a defensive guard) — in practice this
  // never runs for an admin session, since both call sites are user-only.
  renderMyAttendance() {
    const summaryEl = document.getElementById('my-attendance-summary');
    const listEl = document.getElementById('my-attendance-list');
    if (!summaryEl || !listEl) return;

    // Guards against the attendance listener firing before the History tab
    // has ever been opened once — _historyYear/_historyMonth would
    // otherwise be undefined here. Idempotent (only sets if unset), so
    // calling it again from renderHistory() right after is a no-op.
    this._initHistoryState();
    const { fromKey, toKey } = this._monthKeyBounds(this._historyYear, this._historyMonth);
    // this._sanghAttendanceNode is the live sangh_attendance listener's
    // cached raw node (see setupRealtimeSync()) — no extra read needed for
    // the same stricter absence rule the admin exports apply.
    const takenDates = this._extractTakenDates(this._sanghAttendanceNode, fromKey, toKey);

    const paint = (attendance) => {
      const { daysPresent, totalGathas, pct } = this._summarizeAttendance(attendance, fromKey, toKey, takenDates);
      const tiles = [
        { value: daysPresent, label: 'Days Present' },
        { value: totalGathas, label: 'Total Gathas' },
        { value: `${pct}%`, label: 'Attendance' },
      ];
      summaryEl.innerHTML = tiles
        .map(t => `<div class="stat-item"><span class="stat-value">${t.value}</span><span class="stat-label">${t.label}</span></div>`)
        .join('');

      // Newest first — matches Activity History's own ordering above.
      const rows = Object.entries(attendance || {})
        .filter(([dateKey, rec]) => rec && dateKey >= fromKey && dateKey <= toKey)
        .sort(([a], [b]) => b.localeCompare(a));

      listEl.innerHTML = rows.length > 0
        ? rows.map(([dateKey, rec]) => {
            const gathas = rec.gathas || 0;
            return `
            <div class="niyam-stat-row">
              <span class="niyam-stat-icon">${rec.present ? '✅' : '❌'}</span>
              <span class="niyam-stat-label">${this._formatHistoryDate(dateKey)}</span>
              <span class="niyam-stat-value">${gathas} gatha${gathas === 1 ? '' : 's'}</span>
            </div>`;
          }).join('')
        : '<div style="text-align:center; padding:20px; color:#795548;">No attendance recorded this month.</div>';
    };

    if (this._cachedAttendance) {
      paint(this._cachedAttendance);
      return;
    }

    // Listener hasn't fired yet (e.g. this runs before setupRealtimeSync()'s
    // non-awaited attendance listener resolves) — one-shot fallback fetch,
    // mirroring renderNiyamStats()'s identical _cachedDailyLogs fallback.
    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#795548;">Loading...</div>';
    db.ref(`users/${this.uid}/attendance`).once('value')
      .then(snap => {
        this._cachedAttendance = snap.val() || {};
        paint(this._cachedAttendance);
      })
      .catch(e => {
        console.error('Failed to load attendance:', e);
        listEl.innerHTML = '<div style="text-align:center; color:red;">Failed to load attendance.</div>';
      });
  }

  // ===== PROFILE TAB =====
  async renderProfile() {
    // Header (name/email) — from the already-loaded auth user, no network needed.
    const user = this._currentAuthUser || {};
    const nameHeaderEl = document.getElementById('profile-header-name');
    if (nameHeaderEl) nameHeaderEl.textContent = user.name || '';
    const emailEl = document.getElementById('profile-header-email');
    if (emailEl) emailEl.textContent = user.email || '';

    // Photo: instant paint from cache/Google account, then upgrades from
    // Firebase in the background — not awaited, same pattern as the rest of
    // this tab. See _loadAvatarInto().
    this._loadProfilePhoto();

    // Firebase is master, so this is simply the profile — no second,
    // slower "authoritative" source to reconcile against afterwards.
    try {
      const snap = await db.ref(`users/${this.uid}/registration`).once('value');
      this._paintProfile(snap.val() || {});
    } catch (e) {
      console.warn('Failed to load registration from Firebase:', e);
    }
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

  // Instant paint from cache/Google account photo, then a background
  // upgrade from Firebase (users/{uid}/photo). Shared by the Profile tab's
  // own photo and the header avatar button (_loadHeaderAvatar()) — same
  // cache-then-fetch shape, different target elements.
  async _loadAvatarInto(imgId, placeholderId) {
    const avatarEl = document.getElementById(imgId);
    const placeholderEl = document.getElementById(placeholderId);
    if (!avatarEl) return;

    // This session's own identity, not this.uid — see _activeProfileId()'s
    // comment. Matters here because the admin header now calls this too,
    // and this.uid on the admin panel is never the admin themselves.
    const profileId = this._activeProfileId();
    const cacheKey = `myniyam_photo_${profileId}`;
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

    // The Google account's own photo is only a sensible placeholder for the
    // PRIMARY profile (it IS that Google identity). For an added profile —
    // e.g. a child's — falling back to it would briefly show the parent's
    // Google photo under the child's name until fetchPhoto() resolves.
    const googlePlaceholder = this._isPrimaryProfile() ? (this._currentAuthUser && this._currentAuthUser.photoURL) : null;
    applyPhoto(cached || googlePlaceholder || null);

    if (!profileId) return;
    const photo = await Auth.fetchPhoto(profileId); // never throws; null on any failure or "no photo"
    if (photo) {
      applyPhoto(photo);
      try { localStorage.setItem(cacheKey, photo); } catch (e) { /* storage full — non-fatal */ }
    }
  }

  // True for the primary profile (slot 1) — also true for a pre-multi-
  // profile session shape (no baseUid field at all), which was always
  // single-profile/primary by definition.
  _isPrimaryProfile() {
    const u = this._currentAuthUser;
    return !!u && (!u.baseUid || u.uid === u.baseUid);
  }

  async _loadProfilePhoto() {
    return this._loadAvatarInto('profile-avatar', 'profile-avatar-placeholder');
  }

  async _loadHeaderAvatar() {
    return this._loadAvatarInto('header-avatar-img', 'header-avatar-placeholder');
  }

  async _loadAdminHeaderAvatar() {
    return this._loadAvatarInto('admin-header-avatar-img', 'admin-header-avatar-placeholder');
  }

  // Bound to the Profile tab's "Change photo" file input. Firebase-first:
  // the change's success/failure is decided by the users/{uid}/photo
  // write alone. Auth.updatePhoto() (the Sheet mirror) runs afterwards in
  // the background, purely to keep the Sheet's copy current for your own
  // reference.
  async _handleProfilePhotoChange(file) {
    const errorEl = document.getElementById('profile-error');
    if (errorEl) errorEl.classList.add('hidden');
    try {
      const dataUrl = await this._resizeImageToDataUrl(file);
      await db.ref(`users/${this.uid}/photo`).set(dataUrl);

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

      // Background Sheet write — never awaited, never blocks the UI update
      // above. updatePhoto() resolves { success: false } rather than
      // rejecting on a Sheet-side failure, so both are checked; either way
      // it's just logged, never surfaced to the user.
      Auth.updatePhoto(this.uid, dataUrl).then(result => {
        if (!result.success) console.warn('Background Sheet photo update failed (non-fatal):', result.error);
      }).catch(e => console.warn('Background Sheet photo update failed (non-fatal):', e));
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

  // Paints the read-only fields, sangh chip, and editable inputs from the
  // Firebase registration object (name, dob, phone, city, area, sanghCode).
  // Skips an input the user is actively typing in so a re-paint can't
  // clobber an in-progress edit.
  _paintProfile(data) {
    const nameEl = document.getElementById('profile-view-name');
    if (nameEl) nameEl.textContent = data.name || this._currentAuthUser.name || '—';

    const dobEl = document.getElementById('profile-view-dob');
    if (dobEl) dobEl.textContent = data.dob ? this._formatDob(data.dob) : '—';

    const genderEl = document.getElementById('profile-view-gender');
    if (genderEl) genderEl.textContent = data.gender || '—';

    const phoneEl = document.getElementById('profile-phone');
    if (phoneEl && document.activeElement !== phoneEl) phoneEl.value = data.phone || '';
    const cityEl = document.getElementById('profile-city');
    if (cityEl && document.activeElement !== cityEl) cityEl.value = data.city || '';
    const areaEl = document.getElementById('profile-area');
    if (areaEl && document.activeElement !== areaEl) areaEl.value = data.area || '';
    const rollNoEl = document.getElementById('profile-rollno');
    if (rollNoEl && document.activeElement !== rollNoEl) rollNoEl.value = data.rollNo || '';

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

    // sanghs/ is authoritative — its name/city win even when this member's
    // own stored sanghName/sanghCity have a value, so a sangh renamed in
    // the database shows up here instead of sticking on signup-time data.
    // The stored values are only the fallback, for a code no longer in
    // sanghs/ at all (a removed sangh).
    let name = data.sanghName;
    let city = data.sanghCity;
    try {
      const sanghs = await Auth.fetchSanghs();
      const match = sanghs.find(s => s.code === code);
      if (match) { name = match.name; city = match.city; }
    } catch (e) { /* fall back to the stored values already assigned above */ }
    el.innerHTML = name
      ? `<span class="sangh-chip"><strong>${code}</strong> — ${name}${city ? ', ' + city : ''}</span>`
      : `<span class="sangh-chip"><strong>${code}</strong></span>`;
  }

  // Writes profile fields to Firebase (users/{uid}/registration) with
  // update() (not set()) so untouched keys like sanghName/sanghCity/dob
  // survive. Also mirrors name to the denormalized users/{uid}/name path
  // the admin leaderboard reads. Firebase is master now, so — unlike its
  // old "best-effort mirror after the Sheet already confirmed success" role
  // — this must propagate a failure rather than swallow it: it's the ONLY
  // thing saveProfileEdits() now waits on to decide whether the save
  // actually worked.
  async _mirrorProfileToFirebase(profile) {
    const updates = {};
    ['name', 'dob', 'phone', 'city', 'area', 'rollNo', 'sanghCode'].forEach(k => {
      if (profile[k] !== undefined) updates[k] = profile[k];
    });
    if (Object.keys(updates).length === 0) return;
    await db.ref(`users/${this.uid}/registration`).update(updates);
    if (updates.name) {
      await db.ref(`users/${this.uid}/name`).set(updates.name);
    }
  }

  // Bound to #btn-profile-save. Firebase-first: the save's success/failure is
  // decided by the Firebase write alone, so it's instant and never blocked by
  // Apps Script. Auth.updateProfile() (the Sheet write) runs afterwards in
  // the background, purely to keep the Sheet's copy current for your own
  // reference — its outcome never affects what the user sees.
  async saveProfileEdits() {
    const phone = document.getElementById('profile-phone').value.trim();
    const city = document.getElementById('profile-city').value.trim();
    const area = document.getElementById('profile-area').value.trim();
    const rollNo = document.getElementById('profile-rollno').value.trim();
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
    // Optional — same rule as registration (see handleRegistration()).
    if (rollNo && !/^[0-9]{1,6}$/.test(rollNo)) {
      errorEl.textContent = 'Roll No. must be numbers only (up to 6 digits).';
      errorEl.classList.remove('hidden');
      return;
    }

    errorEl.classList.add('hidden');
    btn.disabled = true;
    const btnSpan = btn.querySelector('span');
    const originalLabel = btnSpan.textContent;
    btnSpan.textContent = 'Saving...';

    try {
      await this._mirrorProfileToFirebase({ phone, city, area, rollNo });
      confEl.classList.remove('hidden');
      setTimeout(() => confEl.classList.add('hidden'), 2500);
      // Background Sheet write — never awaited, never blocks the
      // confirmation above. updateProfile() resolves { success: false }
      // rather than rejecting on a Sheet-side failure, so both are checked;
      // either way it's just logged, never surfaced to the user.
      Auth.updateProfile(this.uid, { phone, city, area, rollNo }).then(result => {
        if (!result.success) console.warn('Background Sheet profile update failed (non-fatal):', result.error);
      }).catch(e => console.warn('Background Sheet profile update failed (non-fatal):', e));
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
    // This member's OWN sangh settings, not the admin's — see
    // _settingsForMember(). Passed explicitly so _renderHistoryDays() never
    // has to guess which member it's being called for.
    const memberSettings = this._settingsForMember(this._adminSelectedUid);
    const memberRecord = (this._adminUserRecords || {})[this._adminSelectedUid];
    const memberAttendance = (memberRecord && memberRecord.attendance) || null;
    const memberTakenDates = this._takenDatesForMember(this._adminSelectedUid, '0000-00-00', this.getTodayKey());
    this._renderHistoryDays(listEl, allLogs, this._adminHistoryYear, this._adminHistoryMonth, true, memberSettings, memberAttendance, memberTakenDates);

    // Lifetime stats for the currently-viewed user, at the bottom of the
    // History section — shares _renderLifetimeStats() with the user's own
    // Badges tab so the two can never disagree.
    this._renderLifetimeStats(document.getElementById('admin-stats-grid'), memberSettings, memberAttendance, memberTakenDates);
  }

  // `settingsOverride` (optional, trailing) lets an admin drill-down pass
  // the specific member's OWN resolved settings (see renderAdminHistory())
  // instead of falling back to this.settings — which, for an admin session,
  // is never any particular member's sangh (see resolveSettings()). The
  // user-side call site (renderMyAttendance()) omits it, so this.settings
  // (already that user's own) keeps working exactly as before.
  // `attendance`/`takenDates` (optional, mirror _renderLifetimeStats()'s
  // pattern) add a Present/Absent + gathas line to each day. `attendance`
  // is checked against `undefined` specifically — a member with none
  // legitimately passes `null`, which must not fall back to the ADMIN's
  // own cached attendance.
  _renderHistoryDays(container, allLogs, year, month, isAdmin, settingsOverride, attendance, takenDates) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = this.getTodayKey();
    const s = settingsOverride || this.settings || DEFAULT_SETTINGS;
    const att = attendance !== undefined ? attendance : this._cachedAttendance;
    const taken = takenDates !== undefined ? takenDates : this._extractTakenDates(this._sanghAttendanceNode, `${year}-01-01`, today);
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

      // Attendance is its own Firebase node (users/{uid}/attendance/{date}),
      // independent of daily_logs — a day can have one, both, or neither.
      // Shown when either a real record exists, or the date is known to
      // have been taken (see _extractTakenDates()) so an unmarked member on
      // a day the class ran reads "Absent", matching
      // _summarizeAttendance()'s same stricter rule rather than silently
      // showing nothing. Genuinely unknown days (no record, not in
      // `taken`, or `taken` itself null — fallback mode) show nothing,
      // same as before this existed.
      let attendanceHtml = '';
      if (att) {
        const attRec = att[dateKey];
        if (attRec || (taken && taken.has(dateKey))) {
          const present = !!(attRec && attRec.present);
          const gathas = (attRec && attRec.gathas) || 0;
          attendanceHtml = `<div class="history-attendance">${present ? '✅ Present' : '❌ Absent'}${gathas ? ` · 📿 ${gathas}` : ''}</div>`;
        }
      }

      if (!log) {
        html += `<div class="history-day history-empty">
          <div class="history-date">${this._formatHistoryDate(dateKey)}</div>
          <div class="history-summary">No data recorded</div>
          ${attendanceHtml}
          ${editBtn}
        </div>`;
        continue;
      }

      // Every niyam — built-in and custom — is counted once by the same
      // registry walk the dashboard and Perfect Day use, so a day card's
      // "3/12" can never disagree with them.
      const rp = this._registryProgress(log, s);
      const total = rp.total, done = rp.completed;

      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const kp = log.kpEarned || 0;
      const isPerfect = log.perfectDay;
      const statusClass = isPerfect ? 'history-perfect' : (pct >= 50 ? 'history-good' : 'history-low');

      const icons = this._registryIcons(log, s);

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
        ${attendanceHtml}
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
  // Pure — no DOM, no network. Walks every log entry whose YYYY-MM-DD key
  // falls within [fromKey, toKey] (inclusive; zero-padded keys sort
  // lexicographically = chronologically, the same range filter
  // _collectExportRows() relies on) and tallies per-niyam days/amounts plus
  // total AP, days logged, and perfect days. Shared by the Monthly Niyam
  // Stats overlay (month-scoped, via _computeNiyamStats() below), the
  // lifetime stats grid (full history), and the admin Excel export (an
  // admin-chosen range) — one definition of "followed" everywhere.
  // `includePenalties` gates `penalty: true` entries (Screen Time): off for
  // the Monthly overlay (a penalty was never something "followed"), on for
  // the lifetime grid and export, where the raw amount is still useful.
  // `pointsMap` (optional, trailing) lets an admin aggregate that spans
  // MULTIPLE sanghs pass each member's own resolved point map — see
  // _adminSanghPointMap(). Omitted, computeRawDayPoints() falls back to
  // this session's own livePoints(), which is what every user-side call
  // site (the lifetime grid, the Monthly Niyam Stats overlay) wants.
  _computeNiyamRange(logs, fromKey, toKey, settings, includePenalties = true, pointsMap) {
    const s = settings || DEFAULT_SETTINGS;
    const enabled = NIYAM_STATS.filter(n => s[n.flag] && (!n.parentFlag || s[n.parentFlag]) && (includePenalties || !n.penalty));
    const stats = enabled.map(n => ({
      icon: n.icon, label: n.label, days: 0,
      amount: n.amount ? 0 : null, formatAmount: n.formatAmount || null,
      exportUnit: n.exportUnit || null,
    }));

    const safeLogs = logs || {};
    let daysLogged = 0, perfectDays = 0, totalAP = 0;

    Object.entries(safeLogs).forEach(([dateKey, log]) => {
      if (!log || dateKey < fromKey || dateKey > toKey) return;
      daysLogged++;
      if (log.perfectDay) perfectDays++;
      totalAP += computeRawDayPoints(log, pointsMap);

      enabled.forEach((n, i) => {
        if (n.countsDay(log, s)) stats[i].days++;
        if (n.amount) stats[i].amount += (n.amount(log) || 0);
      });
    });

    return { stats, daysLogged, perfectDays, totalAP };
  }

  // Pure — the [fromKey, toKey] bounds for a calendar month, capped at
  // today so a partial (current) month never counts unhappened days. For a
  // future month this makes toKey < fromKey, which _computeNiyamRange()
  // naturally resolves to zero matches. Shared by _computeNiyamStats() and
  // the poster's monthly-AP ranking, so the two can never disagree on what
  // "this month" means.
  _monthKeyBounds(year, month) {
    const today = this.getTodayKey();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const fromKey = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDayKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const toKey = lastDayKey < today ? lastDayKey : today;
    return { fromKey, toKey };
  }

  // `settingsOverride` (optional) mirrors _renderHistoryDays()'s — the
  // admin call site (renderNiyamStats()) passes the specific member's own
  // resolved settings; the user-side call keeps using this.settings.
  _computeNiyamStats(logs, year, month, settingsOverride) {
    const today = this.getTodayKey();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Calendar-bounded day count — every day this month that has actually
    // occurred (capped at today), independent of whether it has a log at
    // all. Can't come from _computeNiyamRange(), which only walks entries
    // that exist in `logs`.
    let daysElapsed = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dateKey > today) break; // future — this and every later day this month haven't happened
      daysElapsed++;
    }

    const { fromKey, toKey } = this._monthKeyBounds(year, month);
    // totalAP is a full computeRawDayPoints() sum per day — independent of
    // the `includePenalties: false` filter above, which only decides which
    // per-niyam rows come back. So this is the month's complete points
    // total (Ashta and the screen-time penalty included), matching what the
    // History day cards add up to.
    const { stats, daysLogged, perfectDays, totalAP } =
      this._computeNiyamRange(logs, fromKey, toKey, settingsOverride || this.settings, false);

    return { stats, daysElapsed, daysRecorded: daysLogged, perfectDays, totalAP };
  }

  // ===== LEADERBOARD POSTER =====

  // Always resets to the current month on open — matches openNiyamStats()'s
  // reasoning, so a stale month from a previous session never lingers.
  openPosterOverlay() {
    const now = new Date();
    this._posterMonth = now.getMonth();
    this._posterYear = now.getFullYear();
    const overlay = document.getElementById('poster-overlay');
    if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('show'); }
    this._renderPoster();
  }

  closePosterOverlay() {
    const overlay = document.getElementById('poster-overlay');
    if (overlay) { overlay.classList.remove('show'); overlay.classList.add('hidden'); }
  }

  _changePosterMonth(delta) {
    const now = new Date();
    let newMonth = this._posterMonth + delta;
    let newYear = this._posterYear;
    if (newMonth > 11) { newMonth = 0; newYear++; }
    if (newMonth < 0) { newMonth = 11; newYear--; }
    // Never advance past the current calendar month — there is no "this
    // month" data for a month that hasn't happened yet.
    if (newYear > now.getFullYear() || (newYear === now.getFullYear() && newMonth > now.getMonth())) return;
    this._posterMonth = newMonth;
    this._posterYear = newYear;
    this._renderPoster();
  }

  // Ranks this sangh's eligible users (_eligibleSanghUsers()) by the
  // selected month's AP via _computeNiyamRange(), the same "total AP"
  // definition the export and lifetime stats grid already use, so the
  // poster can never disagree with the rest of the app. Zero-AP users are
  // dropped — a poster crediting someone with 0 AP is worse than not
  // showing them. Fetches fresh via _fetchAdminUsers() (scoped to this
  // admin's own managed sangh(s), not a whole-`users` download) rather
  // than reusing this._adminUserRecords, so the poster reflects the
  // latest data regardless of how long the leaderboard tab has been open.
  async _computePosterWinners(year, month) {
    const allUsers = await this._fetchAdminUsers();
    const eligible = this._eligibleSanghUsers(allUsers);
    const s = this.settings || DEFAULT_SETTINGS;
    const { fromKey, toKey } = this._monthKeyBounds(year, month);

    return eligible
      .map(({ uid, data }) => {
        const logs = data.daily_logs || {};
        const sanghCode = data.registration && data.registration.sanghCode;
        const pointsMap = this._adminSanghPointMap(sanghCode);
        const { totalAP } = this._computeNiyamRange(logs, fromKey, toKey, s, true, pointsMap);
        return { uid, name: data.name || uid, ap: totalAP };
      })
      .filter(u => u.ap > 0)
      .sort((a, b) => b.ap - a.ap)
      .slice(0, 3);
  }

  // Resolves to an Image on success, or null on ANY failure (missing src,
  // network error, corrupt data) — the poster must never fail to render
  // just because one winner's photo didn't load; _drawAvatar() falls back
  // to an initials circle whenever this resolves null.
  _loadImage(src) {
    return new Promise(resolve => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // Canvas silently falls back to a system font if a webfont isn't loaded
  // yet at draw time — there is no visible error, just a wrong-looking
  // poster. Explicitly loading every face/weight/size used, then awaiting
  // document.fonts.ready, guarantees Outfit/Inter are actually painted.
  async _ensurePosterFonts() {
    if (!document.fonts) return; // very old browser — draws with a system fallback, non-fatal
    try {
      await Promise.all([
        document.fonts.load("800 66px 'Outfit'"),
        document.fonts.load("700 40px 'Outfit'"),
        document.fonts.load("600 34px 'Outfit'"),
        document.fonts.load("500 24px 'Inter'"),
      ]);
      await document.fonts.ready;
    } catch (e) {
      console.warn('Poster font preload failed — falling back to system font:', e);
    }
  }

  // Shrinks the font until `text` fits within maxWidth (down to a floor),
  // then ellipsizes as a last resort. Returns the resolved size AND text —
  // caller owns setting ctx.font before measuring/drawing with either. Long
  // Gujarati/Hindi names must never bleed off a pedestal.
  _fitText(ctx, text, maxWidth, startSize, weight, family) {
    const safe = text || '';
    let size = startSize;
    const minSize = Math.max(14, Math.floor(startSize * 0.5));
    ctx.font = `${weight} ${size}px ${family}`;
    while (ctx.measureText(safe).width > maxWidth && size > minSize) {
      size -= 2;
      ctx.font = `${weight} ${size}px ${family}`;
    }
    let finalText = safe;
    if (ctx.measureText(finalText).width > maxWidth) {
      while (finalText.length > 1 && ctx.measureText(finalText + '…').width > maxWidth) {
        finalText = finalText.slice(0, -1);
      }
      finalText = finalText.length > 0 ? finalText + '…' : '…';
    }
    return { size, text: finalText };
  }

  _roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }

  // Draws a circular photo (centre-cropped like _resizeImageToDataUrl(),
  // app.js:2773) at (cx, cy) with radius r and a coloured ring; draws a
  // coloured initial circle instead when img is null (no photo, or
  // fetchPhoto failed) — the poster always shows a complete podium.
  _drawAvatar(ctx, img, cx, cy, r, ringColor, fallbackLetter) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fillStyle = ringColor;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (img) {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, cx - r, cy - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = '#F4A261';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.floor(r * 1.1)}px 'Outfit', sans-serif`;
      ctx.fillText(fallbackLetter || '?', cx, cy + Math.floor(r * 0.08));
    }
    ctx.restore();
  }

  // Pure draw against a fixed 1080×1350 canvas — no DOM reads beyond `ctx`
  // and `model`, so the output is identical regardless of the admin's
  // screen size. `model.winners` is rank-ordered (index 0 = rank 1) and may
  // have 1–3 entries; only the ranks that exist are drawn, and the layout
  // re-centres itself for 1 or 2 winners rather than leaving a gap where a
  // missing 3rd place would have been.
  _drawPoster(ctx, model) {
    const W = 1080, H = 1350;
    const CX = W / 2;

    // ---- Background ----
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#F4A261');
    bgGrad.addColorStop(0.42, '#E8722A');
    bgGrad.addColorStop(1, '#C45E1F');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(CX, 260, 40, CX, 260, 640);
    glow.addColorStop(0, 'rgba(255,255,255,0.30)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(CX, 430, 300 + i * 80, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    [[110, 140], [970, 180], [80, 540], [1000, 580], [140, 1060], [940, 1090], [540, 1330]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // ---- Header ----
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffffff';
    ctx.font = "800 66px 'Outfit', sans-serif";
    ctx.fillText('🙏 MyNiyam', CX, 118);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    const sanghFit = this._fitText(ctx, model.sanghName || 'MyNiyam Sangh', W - 160, 34, '600', "'Outfit', sans-serif");
    ctx.font = `600 ${sanghFit.size}px 'Outfit', sans-serif`;
    ctx.fillText(sanghFit.text, CX, 166);

    const pillLabel = `${(model.monthLabel || '').toUpperCase()} CHAMPIONS`;
    ctx.font = "700 30px 'Outfit', sans-serif";
    const pillW = ctx.measureText(pillLabel).width + 84;
    const pillH = 60;
    const pillX = CX - pillW / 2;
    const pillY = 202;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    this._roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(pillLabel, CX, pillY + pillH / 2 + 10);

    // ---- Podium ----
    const groundY = 1120;
    const pedestalHalfWidth = 130;
    // Per-rank x-offset from centre, keyed by how many winners exist — a
    // 1- or 2-place podium re-centres itself instead of reusing the 3-place
    // offsets and leaving a lopsided gap where the missing place would be.
    const dxLayouts = {
      1: { 1: 0 },
      2: { 1: -170, 2: 170 },
      3: { 1: 0, 2: -320, 3: 320 },
    };
    const dxByRank = dxLayouts[model.winners.length] || dxLayouts[3];

    const slotSpecs = [
      { rank: 1, height: 300, radius: 116, ring: '#FFD700', medal: '🥇' },
      { rank: 2, height: 220, radius: 94, ring: '#E2E2E2', medal: '🥈' },
      { rank: 3, height: 160, radius: 94, ring: '#E3A971', medal: '🥉' },
    ];

    slotSpecs.forEach(slot => {
      const winner = model.winners[slot.rank - 1];
      if (!winner) return;

      const cx = CX + (dxByRank[slot.rank] || 0);
      const pedestalTopY = groundY - slot.height;

      // Pedestal box
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      this._roundRectPath(ctx, cx - pedestalHalfWidth, pedestalTopY, pedestalHalfWidth * 2, slot.height, 18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      this._roundRectPath(ctx, cx - pedestalHalfWidth, pedestalTopY, pedestalHalfWidth * 2, slot.height, 18);
      ctx.stroke();

      // Medal + AP inside the pedestal
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '44px sans-serif';
      ctx.fillText(slot.medal, cx, pedestalTopY + 66);
      ctx.font = "800 36px 'Outfit', sans-serif";
      ctx.fillText(`${winner.ap} AP`, cx, pedestalTopY + slot.height - 34);

      // Name — sits just above the pedestal; font may shrink for a long name
      const nameFit = this._fitText(ctx, winner.name, pedestalHalfWidth * 2 - 20, 36, '700', "'Outfit', sans-serif");
      const nameBaselineY = pedestalTopY - 14;
      ctx.font = `700 ${nameFit.size}px 'Outfit', sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(nameFit.text, cx, nameBaselineY);

      // Photo — sits above the name with a fixed gap, computed from the
      // name's ACTUAL rendered size so a shrunk name can never collide with it
      const nameTopY = nameBaselineY - nameFit.size * 0.8;
      const photoCenterY = nameTopY - 16 - slot.radius;
      const fallbackLetter = (winner.name || '').trim().charAt(0).toUpperCase() || '?';
      // _drawAvatar() wraps its own state changes in save()/restore(), so
      // ctx.textAlign/textBaseline/fillStyle are back to this function's
      // values (center/alphabetic) immediately after it returns.
      this._drawAvatar(ctx, winner.img, cx, photoCenterY, slot.radius, slot.ring, fallbackLetter);

      // Crown for rank 1 — sits above the photo
      if (slot.rank === 1) {
        const photoTopY = photoCenterY - slot.radius;
        ctx.font = '60px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('👑', cx, photoTopY - 26);
      }
    });

    // ---- Footer ----
    // Matches the app-wide "Presented by / Developed by" credit — see the
    // shared .app-footer block in index.html and its identical wording.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = "700 30px 'Outfit', sans-serif";
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText('🌐 myniyam.heersena.com', CX, 1230);
    ctx.font = "500 22px 'Inter', sans-serif";
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('Presented by Heer Sena', CX, 1268);
    ctx.fillText('Developed by Tanmay Dhelariya', CX, 1298);
  }

  _posterFileName() {
    return `MyNiyam_Champions_${this._posterYear}-${String(this._posterMonth + 1).padStart(2, '0')}.png`;
  }

  _triggerDownloadFromBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  _downloadPoster() {
    const canvas = document.getElementById('poster-canvas');
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      this._triggerDownloadFromBlob(blob, this._posterFileName());
    }, 'image/png');
  }

  _sharePoster() {
    const canvas = document.getElementById('poster-canvas');
    if (!canvas) return;

    canvas.toBlob(async blob => {
      if (!blob) return;
      const fileName = this._posterFileName();
      const file = new File([blob], fileName, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'MyNiyam Champions' });
          return;
        } catch (e) {
          // A user-cancelled share rejects with AbortError — not a real
          // failure, so it must not fall through to an unrequested download.
          if (e && e.name === 'AbortError') return;
          console.warn('Share failed, falling back to download:', e);
        }
      }
      this._triggerDownloadFromBlob(blob, fileName);
    }, 'image/png');
  }

  // Orchestrates one poster render: ranks the selected month's winners,
  // fetches their photos (never fails the whole poster — see _loadImage()),
  // waits for webfonts to actually be ready, then draws. The "nobody
  // scored" case and any error both leave the canvas blank with inline
  // messaging rather than a half-drawn poster.
  async _renderPoster() {
    const canvas = document.getElementById('poster-canvas');
    const labelEl = document.getElementById('poster-month-label');
    const errorEl = document.getElementById('poster-error');
    const actionsEl = document.getElementById('poster-actions');
    const nextBtn = document.getElementById('btn-poster-next');
    if (!canvas) return;

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthLabel = `${monthNames[this._posterMonth]} ${this._posterYear}`;
    if (labelEl) labelEl.textContent = monthLabel;
    if (errorEl) errorEl.classList.add('hidden');
    if (actionsEl) actionsEl.classList.add('hidden');

    if (nextBtn) {
      const now = new Date();
      const atCurrent = this._posterYear === now.getFullYear() && this._posterMonth === now.getMonth();
      nextBtn.disabled = atCurrent;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#795548';
    ctx.font = "500 28px 'Inter', sans-serif";
    ctx.fillText('Loading…', canvas.width / 2, canvas.height / 2);

    try {
      const winners = await this._computePosterWinners(this._posterYear, this._posterMonth);

      if (winners.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (errorEl) {
          errorEl.textContent = 'No one in your sangh earned AP this month yet.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      const [images, sanghLabels] = await Promise.all([
        Promise.all(winners.map(w => Auth.fetchPhoto(w.uid).then(photo => this._loadImage(photo)))),
        this._resolveSanghLabels(this._adminSanghCodes || [], {}, true),
        this._ensurePosterFonts(),
      ]);

      const model = {
        sanghName: (sanghLabels && sanghLabels.length > 0) ? sanghLabels.join(' • ') : 'MyNiyam Sangh',
        monthLabel,
        winners: winners.map((w, i) => ({ name: w.name, ap: w.ap, img: images[i] })),
      };

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this._drawPoster(ctx, model);
      if (actionsEl) actionsEl.classList.remove('hidden');
    } catch (e) {
      console.error('Poster generation failed:', e);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (errorEl) {
        errorEl.textContent = 'Failed to generate the poster. Please try again.';
        errorEl.classList.remove('hidden');
      }
    }
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
    const totalEl = document.getElementById('niyam-stats-total');
    if (!listEl) return;

    let logs = this._cachedDailyLogs;
    if (logs == null) {
      listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#795548;">Loading...</div>';
      if (summaryEl) summaryEl.textContent = '';
      if (totalEl) totalEl.textContent = '';
      try {
        const snap = await db.ref(`users/${this.uid}/daily_logs`).once('value');
        logs = snap.val() || {};
        this._cachedDailyLogs = logs;
      } catch (e) {
        listEl.innerHTML = '<div style="text-align:center; color:red;">Failed to load stats.</div>';
        if (totalEl) totalEl.textContent = '';
        return;
      }
    }

    // This member's OWN sangh settings for an admin drill-down (see
    // _settingsForMember()); this.settings (already correct) for the
    // user's own Achievements-tab entry point.
    const statsSettings = this.currentRole === 'admin' ? this._settingsForMember(this._adminSelectedUid) : this.settings;
    const { stats, daysElapsed, daysRecorded, perfectDays, totalAP } =
      this._computeNiyamStats(logs, this._niyamStatsYear, this._niyamStatsMonth, statsSettings);

    if (totalEl) {
      totalEl.textContent = `⭐ ${(totalAP || 0).toLocaleString()} AP this month`;
    }

    if (summaryEl) {
      summaryEl.textContent = daysElapsed > 0
        ? `${daysRecorded} of ${daysElapsed} day${daysElapsed === 1 ? '' : 's'} logged · ${perfectDays} perfect day${perfectDays === 1 ? '' : 's'}`
        : 'No days have occurred yet in this month.';
    }

    // Attendance/gathas for this same month, ahead of the niyam rows and
    // in the same .niyam-stat-row shape so no new CSS is needed — this
    // member's own record for an admin drill-down, this session's own
    // cache for the user-side entry point. Computed before the "no niyams
    // enabled" early return below so a sangh with everything switched off
    // still shows attendance, which is a separate concern from niyams.
    const { fromKey: attFrom, toKey: attTo } = this._monthKeyBounds(this._niyamStatsYear, this._niyamStatsMonth);
    const attendance = this.currentRole === 'admin'
      ? (((this._adminUserRecords || {})[this._adminSelectedUid] || {}).attendance || null)
      : this._cachedAttendance;
    const takenDates = this.currentRole === 'admin'
      ? this._takenDatesForMember(this._adminSelectedUid, attFrom, attTo)
      : this._extractTakenDates(this._sanghAttendanceNode, attFrom, attTo);
    const attSummary = this._summarizeAttendance(attendance, attFrom, attTo, takenDates);
    const attendanceRows = `
      <div class="niyam-stat-row">
        <span class="niyam-stat-icon">📋</span>
        <span class="niyam-stat-label">Attendance</span>
        <span class="niyam-stat-value">${attSummary.daysPresent} day${attSummary.daysPresent === 1 ? '' : 's'}</span>
      </div>
      <div class="niyam-stat-row">
        <span class="niyam-stat-icon">📿</span>
        <span class="niyam-stat-label">Gathas</span>
        <span class="niyam-stat-value">${attSummary.totalGathas}</span>
      </div>`;

    if (stats.length === 0) {
      listEl.innerHTML = attendanceRows + '<div style="text-align:center; padding:20px; color:#795548;">No niyams are currently enabled.</div>';
      return;
    }

    listEl.innerHTML = attendanceRows + stats.map(st => `
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

    // Shared between a user's own "My Attendance" and an admin's member
    // drill-down (see the click listener in _renderHistoryDays()) — an
    // admin session must resolve THIS specific member's own sangh settings
    // (_settingsForMember()), not their own defaults, or a member whose
    // sangh has customised niyams would show the wrong set here.
    const s = this.currentRole === 'admin' ? this._settingsForMember(this._adminSelectedUid) : (this.settings || DEFAULT_SETTINGS);
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

    // Activity grid — one row per niyam, built straight from the registry
    // so it lists exactly the same set (and in the same order) as Monthly
    // Stats and the day-edit overlay. It used to be a hand-written array
    // PLUS a registry walk, which now that the built-ins live in the
    // registry would have listed every one of them twice.
    const activities = [];
    (typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : []).forEach(entry => {
      if (!entry.flag) return;
      entry.items.forEach(item => {
        const type = item.type || 'toggle';
        // Amount-bearing types show the figure itself instead of a tick —
        // a bare "✓" would hide how many samayiks or minutes were logged.
        let val = '';
        if (type === 'counter') val = `${log[item.prop] || 0}`;
        else if (type === 'duration') val = `${log[item.prop] || 0} min`;
        else if (type === 'screentime') val = `${log[item.prop] || 0}h ${(item.minsProp ? log[item.minsProp] : 0) || 0}m`;
        activities.push({
          key: item.flag || entry.flag,
          parentFlag: item.flag ? item.parentFlag : undefined,
          icon: item.icon || entry.icon || '',
          name: item.label,
          done: this._niyamItemSatisfied(item, log, s),
          val,
        });
      });
    });

    gridEl.innerHTML = activities
      .filter(a => s[a.key] && (!a.parentFlag || s[a.parentFlag]))
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

    gridEl.innerHTML = DAY_EDIT_FIELDS.filter(f => s[f.key] && (!f.parentFlag || s[f.parentFlag])).map(f => {
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
    statDelta('totalRaysiya', before.raiyaDone ? 1 : 0, draft.raiyaDone ? 1 : 0);
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
  // Guarded against an unrecognized tabName (e.g. a stale/foreign back-
  // button history entry routed through _navSwitchToTab()) — never throws,
  // just leaves the current tab showing.
  switchTab(tabName) {
    const tabEl = document.getElementById(`tab-${tabName}`);
    const navEl = document.querySelector(`#bottom-nav .nav-item[data-tab="${tabName}"]`);
    if (!tabEl || !navEl) return;
    document.querySelectorAll('#app .tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
    tabEl.classList.add('active');
    navEl.classList.add('active');
    // Every tab starts scrolled to the top — .tab-content has no overflow
    // of its own (see styles.css), so this is a real window scroll, not an
    // internal one. Without it, switching away from a page scrolled deep
    // (e.g. History) and into a short one leaves the new tab landing
    // mid-scroll instead of at its heading.
    window.scrollTo(0, 0);
    if (tabName === 'achievements') this.renderAchievements();
    if (tabName === 'history') this.renderHistory();
    if (tabName === 'profile') this.renderProfile();
    // Keeps history.state.tab truthful for every caller that isn't a nav
    // button click (that path pushes its own entry — see
    // setupUserEventListeners()) — e.g. goToProfileFromPhotoPrompt() — so
    // back-driven tab switching (_navSwitchToTab()) never reads a stale tab.
    // A plain in-place update, never a new entry. Spreads the existing
    // state first (rather than replacing it outright) so any other field a
    // future caller relies on survives a tab switch it didn't ask about.
    history.replaceState({ ...(history.state || {}), tab: tabName, overlay: null }, '');
  }

  switchAdminTab(tabName) {
    const tabEl = document.getElementById(`admin-tab-${tabName.replace('admin-', '')}`);
    const navEl = document.querySelector(`#admin-bottom-nav .nav-item[data-tab="${tabName}"]`);
    if (!tabEl || !navEl) return;
    document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#admin-bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
    tabEl.classList.add('active');
    navEl.classList.add('active');
    window.scrollTo(0, 0); // see switchTab()'s identical comment
    if (tabName === 'admin-progress') this.renderAdminProgress();
    if (tabName === 'admin-attendance') this.renderAttendance();
    if (tabName === 'admin-leaderboard') this.renderAdminLeaderboard();
    history.replaceState({ ...(history.state || {}), tab: tabName, overlay: null }, '');
  }

  // ===== ADMIN FUNCTIONS =====
  // Generates one merged row per NIYAM_REGISTRY entry into
  // #admin-registry-niyams — label + points input + toggle together,
  // matching the hand-written rows above in index.html. Entries with two
  // scoring items (navkarJaap, devDarshan, guruVandan) get a second,
  // indented "sub" row for items[1] — points only, no toggle of its own,
  // same pattern as the hardcoded Jin Pooja/Ashta Prakari and
  // Pratikraman/Raiya pairs. Idempotent (checks a data-built marker) so a
  // repeated loadAdminSettingsUI() call (tab switches, the settings
  // listener firing mid-edit) never rebuilds it — that would drop whatever
  // the admin was mid-typing.
  // Paints NIYAM_REGISTRY_ERRORS (registerNiyams()'s skipped-entry log) as a
  // visible panel above the niyam settings, so a bad edit to data.js is
  // loud in the admin panel itself — not just a console.error only someone
  // with devtools open would ever see. Hidden entirely, and left exactly as
  // its static markup shipped, when the registry is healthy.
  _renderNiyamRegistryErrors() {
    const el = document.getElementById('niyam-registry-errors');
    if (!el) return;
    if (!NIYAM_REGISTRY_ERRORS.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    const items = NIYAM_REGISTRY_ERRORS
      .map(e => `<li><strong>${this._escHtml(e.id)}</strong> — ${this._escHtml(e.message)}</li>`)
      .join('');
    const count = NIYAM_REGISTRY_ERRORS.length;
    el.innerHTML = `
      <div class="niyam-registry-errors-title">⚠️ ${count} niyam${count === 1 ? '' : 's'} in data.js could not be loaded</div>
      <ul>${items}</ul>`;
    el.classList.remove('hidden');
  }

  _renderAdminNiyamRows() {
    const container = document.getElementById('admin-registry-niyams');
    if (!container || container.dataset.built === '1') return;
    container.dataset.built = '1';

    const REGISTRY = typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : [];
    const sections = [
      { key: 'bhakti', title: '🙏 Dev-Guru Bhakti' },
      { key: 'aachar', title: '⭐ Aachar' },
    ];
    let html = '';
    sections.forEach(sec => {
      const entries = REGISTRY.filter(e => e.flag && e.section === sec.key);
      if (entries.length === 0) return;
      html += `<div class="settings-group"><h3 class="settings-group-title">${sec.title}</h3>`;
      entries.forEach(entry => {
        const toggleId = `admin-toggle-${entry.id}`;
        const main = entry.items[0];
        html += `
          <div class="setting-item niyam-row" data-toggle-id="${toggleId}">
            <div class="niyam-row-label"><label for="${toggleId}">${entry.label}</label><span class="niyam-row-hindi">${entry.labelHindi || ''}</span></div>
            <div class="niyam-row-controls">
              <input type="number" min="0" step="1" id="admin-points-${main.prop}" placeholder="${main.points}">
              <input type="checkbox" id="${toggleId}">
            </div>
          </div>`;
        // Every item after the first is its own independently-toggleable
        // sub-row (registerNiyams() gives each one its own flag) — N of
        // them for an 'exclusive'/'dual' entry with more than 2 items
        // (e.g. Tapasya's 4 tap levels), not just a single items[1].
        entry.items.slice(1).forEach(sub => {
          // sub.flag (registerNiyams()) is this item's own independent
          // toggle — id follows the same admin-toggle-{prop minus "Done"}
          // convention as the hand-written Ashta Prakari/Raiya rows.
          const subToggleId = `admin-toggle-${sub.prop.slice(0, -4)}`;
          html += `
          <div class="setting-item niyam-row niyam-row-sub" data-toggle-id="${subToggleId}" data-parent-toggle-id="${toggleId}">
            <div class="niyam-row-label"><label for="${subToggleId}">↳ ${sub.label}</label><span class="niyam-row-hindi">${sub.labelHindi || ''}</span></div>
            <div class="niyam-row-controls">
              <input type="number" min="0" step="1" id="admin-points-${sub.prop}" placeholder="${sub.points}">
              <input type="checkbox" id="${subToggleId}">
            </div>
          </div>`;
        });
      });
      html += `</div>`;
    });
    container.innerHTML = html;
  }

  // Paints the sangh selector (hidden entirely for a single-sangh admin —
  // the common case) and every points input's VALUE for whichever sangh is
  // selected. Blank input = "use the coded default", shown via its
  // placeholder — NEVER fabricated as an explicit value, since blank and
  // "explicitly set to the default number" are different admin intentions.
  _loadAdminPointInputs() {
    const sel = document.getElementById('admin-points-sangh');
    const groupEl = document.getElementById('admin-points-sangh-group');
    const codes = this._adminSanghCodes || [];
    if (sel) {
      const optionValues = Array.from(sel.options, o => o.value);
      const codesMatch = optionValues.length === codes.length && optionValues.every((v, i) => v === codes[i]);
      if (!codesMatch) {
        const prev = sel.value;
        sel.innerHTML = codes.map(code => `<option value="${this._escHtml(code)}">${this._escHtml(code)}</option>`).join('');
        if (codes.includes(prev)) sel.value = prev;
      }
      if (groupEl) groupEl.classList.toggle('hidden', codes.length <= 1);
    }
    const activeCode = (sel && sel.value) || codes[0];
    if (!activeCode) return; // admin manages no sangh — nothing to paint

    const stored = (this._adminSanghPoints || {})[activeCode];
    const overrides = (stored && stored.points) || {};
    Object.keys(DEFAULT_POINT_MAP).forEach(key => {
      const el = document.getElementById(`admin-points-${key}`);
      if (!el) return;
      const val = overrides[key];
      el.value = (typeof val === 'number' && Number.isFinite(val)) ? val : '';
    });
  }

  // Dims + locks (disables) every merged row's points input whose governing
  // toggle is currently off — a niyam nobody is scoring shouldn't look
  // editable. Purely visual/UI-state: the stored number itself is never
  // touched, so switching a niyam off and back on leaves its points exactly
  // as they were (both _loadAdminPointInputs() and saveAdminSettings() read
  // .value directly regardless of .disabled). Called once after every
  // toggle/points repaint (loadAdminSettingsUI()) and again on every
  // individual toggle flip (see the delegated listener in
  // setupAdminEventListeners()).
  _syncNiyamRowStates() {
    document.querySelectorAll('#admin-tab-settings .niyam-row[data-toggle-id]').forEach(row => {
      const toggle = document.getElementById(row.dataset.toggleId);
      // A sub-row (Ashta Prakari, Raiya, and the 3 registry-generated
      // sub-niyams) also carries data-parent-toggle-id — it only reads as
      // "on" when BOTH its own checkbox and its parent's are checked, so a
      // switched-off parent visibly dims + locks the child too, even
      // though the child's own flag was never touched.
      const parentToggle = row.dataset.parentToggleId ? document.getElementById(row.dataset.parentToggleId) : null;
      const on = !!(toggle && toggle.checked) && (!parentToggle || parentToggle.checked);
      row.classList.toggle('is-off', !on);
      const numEl = row.querySelector('input[type="number"]');
      if (numEl) numEl.disabled = !on;
    });
  }

  loadAdminSettingsUI() {
    // An admin's own in-progress edit must never be silently overwritten by
    // a listener repaint racing in behind it — their own save echoing back
    // through the sangh_config listener, or another admin saving the same
    // sangh concurrently. Cleared on successful save and on sangh-switch
    // (setupAdminEventListeners()) — both of which intentionally WANT a
    // fresh repaint.
    if (this._adminSettingsDirty) return;

    // Loud, not just console-only — any NIYAM_REGISTRY entry registerNiyams()
    // had to skip (a bad edit to data.js) is otherwise invisible outside
    // devtools. Cheap to repaint every call; NIYAM_REGISTRY_ERRORS never
    // changes after the one registerNiyams() pass at module load.
    this._renderNiyamRegistryErrors();

    // Populates/syncs the sangh <select> and paints its points inputs
    // FIRST — resolving `activeCode` just below depends on the select
    // already reflecting the current this._adminSanghCodes.
    this._loadAdminPointInputs();

    const sel = document.getElementById('admin-points-sangh');
    const activeCode = (sel && sel.value) || (this._adminSanghCodes || [])[0];
    // Same precedence as the user-side resolve (see resolveSettings()) —
    // this sangh's own saved settings, over coded defaults. A sangh
    // nobody is currently editing (no active code) still resolves to a
    // sane value via the `null` passed here.
    const s = resolveSettings(activeCode ? (this._adminSanghPoints || {})[activeCode] : null);

    document.getElementById('admin-toggle-navkarsi').checked = s.enableNavkarsi;
    document.getElementById('admin-toggle-wakeup').checked = s.enableWakeup;
    document.getElementById('admin-toggle-sleep').checked = s.enableSleep;
    document.getElementById('admin-toggle-pranam').checked = s.enablePranam;
    document.getElementById('admin-toggle-pooja').checked = s.enablePooja;
    document.getElementById('admin-toggle-ashtaPrakari').checked = s.enableAshtaPrakari;
    document.getElementById('admin-toggle-samayik').checked = s.enableSamayik;
    document.getElementById('admin-toggle-pratikraman').checked = s.enablePratikraman;
    document.getElementById('admin-toggle-raiya').checked = s.enableRaiya;
    document.getElementById('admin-toggle-book').checked = s.enableBookReading;
    document.getElementById('admin-toggle-ratribhojan').checked = s.enableRatriBhojan;
    document.getElementById('admin-toggle-kandmool').checked = s.enableKandmool;
    document.getElementById('admin-toggle-screentime').checked = s.enableScreenTime;
    document.getElementById('admin-toggle-niyam').checked = s.enableDailyNiyam;

    this._renderAdminNiyamRows();
    (typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : []).forEach(entry => {
      if (!entry.flag) return;
      const el = document.getElementById(`admin-toggle-${entry.id}`);
      if (el) el.checked = !!s[entry.flag];
      // Every sub-item (items after the first) with its own flag — see
      // registerNiyams() and _renderAdminNiyamRows()'s subToggleId, same
      // id convention. N of them for a multi-option entry like Tapasya.
      (entry.items || []).slice(1).forEach(sub => {
        if (!sub.flag) return;
        const subEl = document.getElementById(`admin-toggle-${sub.prop.slice(0, -4)}`);
        if (subEl) subEl.checked = !!s[sub.flag];
      });
    });

    const niyamSelect = document.getElementById('admin-select-niyam');
    niyamSelect.innerHTML = '';
    PACHCHAKHANS.forEach((niyam, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = niyam;
      niyamSelect.appendChild(opt);
    });
    niyamSelect.value = s.currentDailyNiyamId || 0;

    // The hand-written built-in rows read their label/Hindi from
    // NIYAM_REGISTRY, same as the dashboard cards — must run after
    // _renderAdminNiyamRows() above so the generated rows exist too.
    this._refreshNiyamLabels();

    // Dims + locks every points input whose niyam is currently off — must
    // run AFTER the toggles above (points inputs themselves were already
    // painted by _loadAdminPointInputs() at the top of this function) so a
    // freshly-painted row is never left enabled for a niyam that is off.
    this._syncNiyamRowStates();
  }

  // Reads every toggle + points input for the currently-selected sangh and
  // writes them BOTH in one atomic update() to sangh_config/{code} — a
  // single write means settings and points can never half-save. Builds a
  // fresh LOCAL object rather than mutating this.settings in place:
  // this.settings is this ADMIN'S OWN session settings (all-defaults,
  // since an admin role never scores anything — see resolveSettings()),
  // entirely separate from whichever sangh is being edited here, which may
  // not even be one the admin belongs to. Mutating this.settings used to
  // conflate the two.
  async saveAdminSettings() {
    const sel = document.getElementById('admin-points-sangh');
    const code = (sel && sel.value) || (this._adminSanghCodes || [])[0];
    if (!code) return; // admin manages no sangh — nothing to save against

    const settings = {
      enableNavkarsi: document.getElementById('admin-toggle-navkarsi').checked,
      enableWakeup: document.getElementById('admin-toggle-wakeup').checked,
      enableSleep: document.getElementById('admin-toggle-sleep').checked,
      enablePranam: document.getElementById('admin-toggle-pranam').checked,
      enablePooja: document.getElementById('admin-toggle-pooja').checked,
      enableAshtaPrakari: document.getElementById('admin-toggle-ashtaPrakari').checked,
      enableSamayik: document.getElementById('admin-toggle-samayik').checked,
      enablePratikraman: document.getElementById('admin-toggle-pratikraman').checked,
      enableRaiya: document.getElementById('admin-toggle-raiya').checked,
      enableBookReading: document.getElementById('admin-toggle-book').checked,
      enableRatriBhojan: document.getElementById('admin-toggle-ratribhojan').checked,
      enableKandmool: document.getElementById('admin-toggle-kandmool').checked,
      enableScreenTime: document.getElementById('admin-toggle-screentime').checked,
      enableDailyNiyam: document.getElementById('admin-toggle-niyam').checked,
      currentDailyNiyamId: parseInt(document.getElementById('admin-select-niyam').value) || 0,
    };
    (typeof NIYAM_REGISTRY !== 'undefined' ? NIYAM_REGISTRY : []).forEach(entry => {
      if (!entry.flag) return;
      const el = document.getElementById(`admin-toggle-${entry.id}`);
      if (el) settings[entry.flag] = el.checked;
      // Every sub-item (items after the first) — N of them for a
      // multi-option entry like Tapasya, not just items[1].
      (entry.items || []).slice(1).forEach(sub => {
        if (!sub.flag) return;
        const subEl = document.getElementById(`admin-toggle-${sub.prop.slice(0, -4)}`);
        if (subEl) settings[sub.flag] = subEl.checked;
      });
    });

    // Points — formerly the separate _saveAdminPoints(), now folded in so
    // both land in the same write. Blank input = "use the coded default",
    // omitted entirely rather than fabricated as an explicit value.
    const points = {};
    Object.keys(DEFAULT_POINT_MAP).forEach(key => {
      const el = document.getElementById(`admin-points-${key}`);
      if (!el) return;
      const raw = el.value;
      if (raw === '') return;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) points[key] = n;
    });

    const pointsVersion = Date.now();
    try {
      await db.ref(`sangh_config/${code}`).update({ settings, points, pointsVersion });
    } catch (e) {
      console.error('Failed to save settings:', e);
      let message = `Failed to save settings (${e.code || e.message || 'unknown error'}).`;
      if (e.code === 'PERMISSION_DENIED') {
        message += '\n\n' + await this._diagnoseAdminPermissionError(code);
      } else {
        message += ' Please check your connection and try again.';
      }
      alert(message);
      return; // dirty flag stays set — nothing below should imply success
    }

    // The write above is the one the admin is actually waiting on, and it
    // succeeded — commit and confirm now, BEFORE the separate (and
    // non-fatal) member rescore below, so a rescore hiccup can never make a
    // genuinely successful settings save look like it failed.
    if (!this._adminSanghPoints) this._adminSanghPoints = {};
    this._adminSanghPoints[code] = { settings, points, pointsVersion };
    // Only cleared on a SUCCESSFUL save — a failed write must not be
    // treated as clean, or the next repaint would silently discard the
    // admin's edits along with the write that never landed.
    this._adminSettingsDirty = false;

    const conf = document.getElementById('save-confirmation');
    conf.classList.remove('hidden');
    setTimeout(() => conf.classList.add('hidden'), 2000);

    // Retroactively rescores every member at the just-saved point values —
    // unchanged from the old _saveAdminPoints(). Deliberately its OWN
    // try/catch: this targets a completely different multi-path write
    // (every member's users/{uid}/…, not sangh_config/{code}) under a
    // different rule, and its failure must never be reported as "settings
    // failed to save" when they plainly just did. Non-fatal by design —
    // _migrateToRawPoints()'s pointsVersion guard re-scores each member on
    // their own next login if this fan-out misses them (offline admin, a
    // very large sangh, etc.), so a console warning is enough here.
    try {
      await this._recomputeSanghPoints(code, pointsVersion);
    } catch (e) {
      console.warn('Settings saved, but rescoring members\' historical points failed — this self-heals on each member\'s next login:', e);
    }
  }

  // Reads the values that decide whether an admin write is allowed, and
  // returns a plain-language explanation of why they disagree. v5's rules
  // check sangh_config/{code}/admins/{baseUid} — keyed by the Firebase
  // Auth base account (always what `auth.uid` is, regardless of which of
  // the account's __pN profile slots is active), set only via the console
  // (SANGH-RUNBOOK.md's admin-provisioning steps). Only called on an
  // actual PERMISSION_DENIED (a real network round trip), never
  // speculatively.
  async _diagnoseAdminPermissionError(code) {
    try {
      const fbUser = firebase.auth().currentUser;
      const authUid = fbUser && fbUser.uid;
      if (!authUid) return 'No active Firebase sign-in was found — please sign in again.';
      if (!code) return 'No sangh is selected to diagnose against — pick one from the dropdown and try again.';

      const adminFlagSnap = await db.ref(`sangh_config/${code}/admins/${authUid}`).once('value');
      const isAdminOfCode = adminFlagSnap.val() === true;

      if (!isAdminOfCode) {
        return `Firebase account "${authUid}" is not listed as an admin of sangh "${code}" — `
          + `check sangh_config/${code}/admins/${authUid} in the Firebase console (see `
          + `SANGH-RUNBOOK.md). This is set by hand; there is no in-app way to grant it.`;
      }
      return `Firebase denied the write even though "${authUid}" is listed as an admin of `
        + `"${code}" — check that the rules deployed in the Firebase console exactly match `
        + `firebase-rules.json.`;
    } catch (diagErr) {
      console.error('Permission diagnostic itself failed:', diagErr);
      return 'Could not run the permission diagnostic (a separate read failed) — check your connection.';
    }
  }

  // Retroactively rescores every member of `code` at the just-saved point
  // values — pure in-memory work (this._adminUserRecords already holds
  // every managed member's full daily_logs, populated by
  // _renderLeaderboardFromUsers()) plus ONE multi-path write, chunked so a
  // very large sangh can't produce a single oversized update. Anyone this
  // fan-out misses (offline at save time, a member outside
  // _adminUserUids, a partial write) self-heals on their own next login —
  // see _migrateToRawPoints()'s pointsVersion guard.
  async _recomputeSanghPoints(code, pointsVersion) {
    const P = this._adminSanghPointMap(code);
    const records = this._adminUserRecords || {};
    const members = Object.entries(records).filter(([, data]) =>
      data && data.registration && data.registration.sanghCode === code
    );
    if (members.length === 0) return;

    const CHUNK = 500; // staged keys per write — keeps any single update comfortably sized
    let updates = {};
    let pending = 0;

    const flush = async () => {
      if (Object.keys(updates).length === 0) return;
      await db.ref('users').update(updates);
      updates = {};
    };

    for (const [uid, data] of members) {
      const logs = data.daily_logs || {};
      let total = 0;
      Object.entries(logs).forEach(([dateKey, log]) => {
        if (!log) return;
        const raw = computeRawDayPoints(log, P);
        total += raw;
        if (log.kpEarned !== raw) {
          updates[`${uid}/daily_logs/${dateKey}/kpEarned`] = raw;
          pending++;
        }
      });
      updates[`${uid}/profile/totalKP`] = Math.max(0, total);
      updates[`${uid}/profile/pointsVersion`] = pointsVersion;
      updates[`${uid}/profile/rawPointsMigrated`] = true;
      pending += 3;
      if (pending >= CHUNK) { await flush(); pending = 0; }
    }
    await flush();
  }

  // Renders the drill-down's profile-details card from a full users/{uid}
  // record — either the leaderboard listener's cached copy or the fallback
  // read selectAdminUser() does on a cache miss. Every row is independently
  // built and dropped when its field is empty, so a member who registered
  // before a field existed (or predates it entirely) shows a shorter card,
  // never a row that reads "undefined".
  renderAdminUserDetails(record) {
    const cardEl = document.getElementById('admin-profile-details');
    if (!cardEl) return;

    const reg = record.registration || {};
    const photo = record.photo || null;
    const name = record.name || '';
    const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';

    const joined = record.registeredAt
      ? new Date(record.registeredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    const cityArea = [reg.city, reg.area].filter(Boolean).join(', ');
    const sangh = reg.sanghName
      ? (reg.sanghCity ? `${reg.sanghName} · ${reg.sanghCity}` : reg.sanghName)
      : (reg.sanghCode || '');

    const rows = [
      ['🔢', 'Roll No.', this._escHtml(reg.rollNo || '')],
      ['📞', 'Phone', reg.phone ? `<a href="tel:${this._escHtml(reg.phone)}">${this._escHtml(reg.phone)}</a>` : ''],
      ['🎂', 'Date of Birth', this._escHtml(reg.dob || '')],
      ['⚧', 'Gender', this._escHtml(reg.gender || '')],
      ['📍', 'City / Area', this._escHtml(cityArea)],
      ['🛕', 'Sangh', this._escHtml(sangh)],
      ['📅', 'Joined', this._escHtml(joined)]
    ].filter(([, , html]) => !!html);

    if (!photo && !name && rows.length === 0) {
      // Nothing at all to show (e.g. an admin's own console-created record
      // has no registration) — hide the card rather than render an empty shell.
      cardEl.classList.add('hidden');
      cardEl.innerHTML = '';
      return;
    }
    cardEl.classList.remove('hidden');

    cardEl.innerHTML = `
      <div class="admin-profile-details-header">
        <div class="admin-profile-details-avatar">
          ${photo ? `<img src="${this._escHtml(photo)}" alt="">` : `<span class="admin-profile-details-initial">${this._escHtml(initial)}</span>`}
        </div>
        <span class="admin-profile-details-name">${this._escHtml(name)}</span>
      </div>
      ${rows.map(([icon, label, html]) => `
        <div class="profile-readonly-row">
          <span class="profile-readonly-label">${icon} ${label}</span>
          <span class="profile-readonly-value">${html}</span>
        </div>
      `).join('')}
    `;
  }

  renderAdminProgress() {
    const p = this.profile;

    // Badges earned
    const badgeCount = (p.badges || []).length;
    document.getElementById('admin-user-level-icon').textContent = '🏅';
    document.getElementById('admin-user-level').textContent = `${badgeCount} Badge${badgeCount === 1 ? '' : 's'} Earned`;
    // Total AP is no longer duplicated here — it's the Lifetime Stats
    // grid's own "Total AP" tile just below (_renderLifetimeStats()), the
    // exact same p.totalKP value. currentStreak stays: it's the streak
    // RIGHT NOW, distinct from Lifetime Stats' "Best Streak"
    // (p.longestStreak) — not a duplicate.
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

  // Replaces the old Lock tab's status card — unlock now lives in the
  // member drill-down (#admin-individual), which always has a selected
  // member, so there's no "no user selected" branch to handle here. Just
  // enables the button when today is locked for whichever member is
  // currently drilled into.
  _renderAdminUnlockButton() {
    const unlockBtn = document.getElementById('btn-unlock-day');
    if (unlockBtn) unlockBtn.disabled = !this.isDayLocked();
  }

  async adminUnlockDay() {
    if (!this._adminSelectedUid) {
      alert('Select a user from the Leaderboard tab first.');
      return;
    }
    if (!this.isDayLocked()) return;
    if (!confirm('🔓 Unlock today\'s submissions? The user will be able to modify today\'s activities again.')) return;

    const todayKey = this.getTodayKey();
    // Await the removal itself (previously fire-and-forget) — the lines
    // below set local state directly rather than waiting on the lock_status
    // listener, so the tab repaints correctly even if that listener was
    // detached (e.g. after switching users) or is momentarily behind.
    await db.ref(`users/${this.uid}/lock_status/${todayKey}`).remove();
    this.currentDayLocked = false;
    this.currentDayLockValue = null;

    // Revert exactly what processEndOfDay() changed when it finalized this
    // day, so a corrected re-submit re-finalizes without double-counting the
    // streak or the perfect-day tally. A day finalized before
    // finalizeSnapshot existed has no snapshot to revert from — leave
    // `finalized` as-is rather than guessing (see processEndOfDay()).
    const snap = this.dailyLog && this.dailyLog.finalizeSnapshot;
    if (this.dailyLog && this.dailyLog.finalized && snap) {
      this.profile.currentStreak = snap.currentStreak;
      this.profile.longestStreak = snap.longestStreak;
      this.profile.totalPerfectDays = snap.totalPerfectDays;
      this.profile.streakFreezeUsed = snap.streakFreezeUsed;
      this.profile.streakFreezeMonth = snap.streakFreezeMonth;
      this.dailyLog.perfectDay = snap.perfectDay;
      this.dailyLog.finalized = false;
      this.dailyLog.finalizeSnapshot = null;
      this.saveProfile();
      this.saveDailyLogFor(todayKey, this.dailyLog);
    }

    this._renderAdminUnlockButton();
    this.renderAdminProgress();
  }

  // ===== LOGOUT =====
  logout() {
    Auth.signOut();
    this.currentRole = null;
    // Defensive reset: if an admin logs out while mid-drill-down into a
    // user, this stops _navOnPopState()'s admin branch from possibly
    // firing on a later, unrelated popstate (e.g. the logout-confirm
    // overlay's own closing consuming its history entry, which arrives
    // asynchronously and could otherwise land after the page has already
    // moved on to the landing screen) and mutating the now-hidden admin
    // panel. Harmless for a user session, where this is already null.
    this._adminSelectedUid = null;
    if (this.autoLockInterval) clearInterval(this.autoLockInterval);
    this._detachAllListeners();
    // v5 has no persistent leaderboard listener to detach (renderAdminLeaderboard()
    // is on-demand — see _fetchAdminUsers()) and no legacy global settings
    // listener either (see resolveSettings()). The per-sangh sangh_config
    // listeners started in initAdmin() are NOT torn down here — same as v4
    // never tore them down either; a logout->login cycle within one page
    // load re-attaches a fresh set rather than replacing them in place.

    // Reset UI
    this._hideLoadingScreen(); // no-op if it wasn't showing — cheap guarantee
    document.getElementById('app').classList.add('app-hidden');
    document.getElementById('app').classList.remove('app-visible');
    document.getElementById('admin-panel').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    // currentRole is already null (set at the top of this function) — force
    // the install banner hidden rather than leaving it floating over the
    // login/landing screen it would otherwise still be sitting on top of.
    const pwaBanner = document.getElementById('pwa-install-banner');
    if (pwaBanner) pwaBanner.classList.add('hidden');

    // Clear error
    const loginErr = document.getElementById('login-error');
    if (loginErr) loginErr.classList.add('hidden');

    // End on the landing page rather than the login card directly — the
    // login card is still prepared underneath (just un-hidden above), ready
    // for whenever the visitor taps through via the landing's footer CTA.
    this.showLanding();
  }

  resetProgress() {
    if (!this._adminSelectedUid) {
      alert('Select a user from the Leaderboard tab first.');
      return;
    }
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
