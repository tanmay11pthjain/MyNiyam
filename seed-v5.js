// ===== MyNiyam v5 — database seed generator =====
//
// Generates the JSON to paste into Firebase Console -> Realtime Database ->
// (root node) -> ⋮ -> Import JSON, for the v5 full-reset restructure (see
// SANGH-RUNBOOK.md and the migration plan). This REPLACES THE ENTIRE TREE —
// export a backup first (⋮ -> Export JSON) before importing this.
//
// Run with:  node seed-v5.js > seed.json
// (or omit the redirect to just eyeball it on stdout — this script has no
// side effects of its own; it only reads data.js/app.js from disk)
//
// The `settings` block is NOT hand-typed. It is derived from the real,
// live NIYAM_REGISTRY (data.js) via registerNiyams() (app.js) — the exact
// same code path the app itself uses to build DEFAULT_SETTINGS — so this
// can never drift from what the registry actually defines. Every niyam's
// enable<Id> flag is then forced to `true` (per the seeded sangh's chosen
// "all niyams enabled" starting point); non-niyam settings (introSeen,
// samayikTarget, currentDailyNiyamId) keep their coded defaults.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJECT_DIR = __dirname;
const SANGH_CODE = 'MN0004';
const SANGH_NAME = 'Shree Vajraswami Tini Mini Pathshala';
const SANGH_CITY = 'Chennai';
const SCHEMA_VERSION = 5;

function loadDefaultSettings() {
  const dataSrc = fs.readFileSync(path.join(PROJECT_DIR, 'data.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(PROJECT_DIR, 'app.js'), 'utf8');

  // Minimal stubs — same shape as the reusable harness used throughout
  // this project's own verification passes. app.js references these at
  // module load time (firebase.initializeApp(), a `db` ref, etc.) even
  // though nothing here ever calls a real Firebase method.
  const noop = () => {};
  const refStub = new Proxy({}, { get: () => () => refStub });
  const sandbox = {
    console,
    firebase: {
      initializeApp: noop,
      database: () => ({ ref: () => refStub }),
      auth: Object.assign(() => ({ currentUser: null, onAuthStateChanged: noop }), {
        GoogleAuthProvider: function () { this.setCustomParameters = noop; },
      }),
      storage: () => ({ ref: () => refStub }),
    },
    document: { addEventListener: noop, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
    window: { matchMedia: () => ({ matches: false }), addEventListener: noop },
    navigator: { userAgent: 'node', maxTouchPoints: 0 },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    setTimeout, clearTimeout, setInterval, clearInterval, Intl, Date, Math, JSON,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    dataSrc + '\n;\n' + appSrc + '\n;\nglobalThis.__DEFAULT_SETTINGS = DEFAULT_SETTINGS;\nglobalThis.__ERRORS = (typeof NIYAM_REGISTRY_ERRORS !== "undefined") ? NIYAM_REGISTRY_ERRORS : [];',
    sandbox,
    { filename: 'bundle.js' }
  );

  if (sandbox.__ERRORS && sandbox.__ERRORS.length > 0) {
    console.error(`WARNING: ${sandbox.__ERRORS.length} NIYAM_REGISTRY ${sandbox.__ERRORS.length === 1 ? 'entry' : 'entries'} failed to load — the generated seed may be missing niyams. Fix data.js first:`);
    sandbox.__ERRORS.forEach(e => console.error(`  - ${e.id}: ${e.message}`));
  }

  return sandbox.__DEFAULT_SETTINGS;
}

function buildAllEnabledSettings() {
  const base = loadDefaultSettings();
  const settings = { ...base };
  Object.keys(settings).forEach(key => {
    if (key.startsWith('enable')) settings[key] = true;
  });
  return settings;
}

function buildSeed() {
  const settings = buildAllEnabledSettings();
  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
    },
    sanghs: {
      [SANGH_CODE]: {
        name: SANGH_NAME,
        city: SANGH_CITY,
        active: true,
      },
    },
    sangh_config: {
      [SANGH_CODE]: {
        settings,
        points: {}, // empty = every niyam scores DEFAULT_POINT_MAP's coded default
        pointsVersion: 0,
        // admins/{baseUid} is intentionally absent — no admin is seeded.
        // See SANGH-RUNBOOK.md's provisioning steps to add one by hand
        // after your first sign-in mints a Firebase Auth uid.
      },
    },
    stats: {
      users: 0,
      sanghs: 1,
    },
  };
}

if (require.main === module) {
  const seed = buildSeed();
  const flagCount = Object.keys(seed.sangh_config[SANGH_CODE].settings).filter(k => k.startsWith('enable')).length;
  console.error(`Generated seed for ${SANGH_CODE} — ${flagCount} niyam flags, all enabled.`);
  console.error('Paste the JSON below into Firebase Console -> Realtime Database -> (root) -> Import JSON.');
  console.error('This REPLACES THE ENTIRE DATABASE — export a backup first.\n');
  process.stdout.write(JSON.stringify(seed, null, 2) + '\n');
}

module.exports = { buildSeed, buildAllEnabledSettings, SANGH_CODE, SANGH_NAME, SANGH_CITY, SCHEMA_VERSION };
