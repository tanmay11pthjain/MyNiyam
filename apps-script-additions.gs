// ============================================================
// MyNiyam — COMPLETE Apps Script backend
//
// This file is NOT loaded by the web app. Paste its ENTIRE contents into your
// Apps Script project (replacing everything currently in Code.gs), then
// redeploy.
//
// WHY THIS IS A FULL REPLACEMENT:
// Testing the live /exec URL returned "Script function not found: doPost".
// The deployed project has no doPost at all, which means NONE of the Sheets
// actions have ever worked — google_login, register and get_sangh_users were
// all failing silently behind the client's try/catch fallbacks. So this file
// now implements every action from scratch and depends on nothing pre-existing.
//
// DEPLOY SETTINGS (all three matter):
//   Deploy -> Manage deployments -> edit (pencil) the existing deployment
//     Version:         New version      <- required, or your edits aren't live
//     Execute as:      Me
//     Who has access:  Anyone           <- anything stricter breaks CORS
//   Keep editing the EXISTING deployment so the /exec URL stays the same;
//   a brand-new deployment gets a different URL and auth.js would need updating.
// ============================================================

// ---- CONFIG ----

// Leave '' if this script is bound to the spreadsheet (Extensions -> Apps Script
// from inside the sheet). If it's a standalone script, paste the spreadsheet ID
// here (the long id in the sheet's URL between /d/ and /edit).
const SPREADSHEET_ID = '';

const USERS_SHEET_NAME  = 'Users';
const SANGH_SHEET_NAME  = 'Sanghs';

// Created automatically if the Users sheet is missing or empty.
//
// TWO photo columns, on purpose:
//   'Photo'      -> the actual visible in-cell image (what you look at)
//   'Photo Data' -> the raw base64 string (what the app reads back)
// Both are needed because once an image is placed in a cell via CellImage,
// Apps Script can no longer read its source URL back out — getValue() returns
// a CellImage object whose getUrl() is null. So the base64 must be kept in its
// own text column for get_photo to serve. You can safely hide 'Photo Data' in
// the Sheet; the script addresses columns by header name, not position.
const USER_HEADERS = [
  'UID', 'Name', 'Email', 'DOB', 'Gender', 'Phone', 'City', 'Area',
  'Sangh Code', 'Role', 'Sangh Codes', 'Registered At', 'Photo', 'Photo Data'
];

// Logical field -> column header text (matched case-insensitively, trimmed).
const USER_COLUMNS = {
  uid: 'UID', name: 'Name', email: 'Email', dob: 'DOB', gender: 'Gender', phone: 'Phone',
  city: 'City', area: 'Area', sanghCode: 'Sangh Code',
  role: 'Role', sanghCodes: 'Sangh Codes', registeredAt: 'Registered At',
  photo: 'Photo', photoData: 'Photo Data'
};

// Row height (px) used for rows carrying a photo, so the in-cell image is
// actually visible instead of squashed into a default ~21px row.
const PHOTO_ROW_HEIGHT = 60;

const SANGH_COLUMNS = { code: 'Code', name: 'Name', city: 'City' };

// Only these may be written by update_profile. Sangh, name, dob, email and uid
// are excluded on purpose: even if a modified client sends them they are
// ignored here. This whitelist — not the client UI — is what actually enforces
// "the user cannot change their sangh".
const PROFILE_EDITABLE_FIELDS = ['phone', 'city', 'area'];

// A Sheets cell caps out around 50,000 characters; base64 inflates binary by
// ~33%, so this leaves headroom for the 256x256 JPEG thumbnail the client
// resizes/compresses down to before ever sending one. Anything over this is
// rejected server-side rather than silently truncated into a corrupt cell.
const MAX_PHOTO_CHARS = 45000;

function _isValidPhotoDataUrl_(photo) {
  return typeof photo === 'string' &&
    /^data:image\/(jpeg|jpg|png|webp);base64,/.test(photo) &&
    photo.length > 0 && photo.length <= MAX_PHOTO_CHARS;
}

// Writes a photo to BOTH photo columns: the raw base64 into 'Photo Data'
// (machine-readable, what get_photo serves) and a real in-cell image into
// 'Photo' (human-readable, what you see in the Sheet).
//
// The image write is wrapped in its own try/catch on purpose: newCellImage()
// is a newer API, and if it ever fails we still want the base64 saved so the
// app keeps working — a missing thumbnail in the Sheet is cosmetic, losing
// the user's photo is not.
function _setPhotoCell_(sheet, colMap, row, dataUrl) {
  _setField_(sheet, colMap, row, 'photoData', dataUrl);

  if (colMap.photo === undefined) return;
  try {
    const image = SpreadsheetApp.newCellImage()
      .setSourceUrl(dataUrl)
      .setAltTextTitle('Profile photo')
      .build();
    sheet.getRange(row, colMap.photo + 1).setValue(image);
    sheet.setRowHeight(row, PHOTO_ROW_HEIGHT);
  } catch (err) {
    Logger.log('Could not render in-cell image (base64 still saved): ' + err);
  }
}

// ---- SHEET HELPERS ----

function _ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActive();
}

function _sanghSheet_() {
  const ss = _ss_();
  if (!ss) return null;
  return ss.getSheetByName(SANGH_SHEET_NAME) || ss.getSheets()[1] || null;
}

// Creates the Users sheet (and its header row) on first use so a fresh
// workbook works without any manual setup.
function _usersSheet_() {
  const ss = _ss_();
  if (!ss) return null;
  let sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(USERS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Builds { logicalField: 0-basedColumnIndex } from row 1, rebuilt on every call
// so reordering or renaming columns in the sheet is picked up automatically.
function _headerMap_(sheet, columnsSpec) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const byText = {};
  headerRow.forEach(function (h, i) { byText[String(h).trim().toLowerCase()] = i; });
  const map = {};
  for (const key in columnsSpec) {
    const text = String(columnsSpec[key]).trim().toLowerCase();
    if (text in byText) map[key] = byText[text];
  }
  return map;
}

function _findUserRow_(sheet, colMap, uid, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const width = sheet.getLastColumn();
  const rows = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const wantUid = String(uid || '').trim();
  const wantEmail = String(email || '').trim().toLowerCase();

  for (let i = 0; i < rows.length; i++) {
    if (colMap.uid !== undefined && wantUid &&
        String(rows[i][colMap.uid]).trim() === wantUid) return i + 2;
  }
  // Fall back to email, but ONLY for a row whose UID cell is still blank —
  // i.e. a row created before the UID was known. Multiple profiles under one
  // Google account (uid, uid__p2, uid__p3, ...) share the same email, so
  // matching by email alone here would silently return a DIFFERENT
  // profile's row (e.g. looking up "uid__p2" would fall through and hit
  // profile 1's row), and a subsequent register/update would overwrite the
  // wrong profile's data.
  if (wantEmail && colMap.email !== undefined) {
    for (let i = 0; i < rows.length; i++) {
      const rowUid = colMap.uid !== undefined ? String(rows[i][colMap.uid] || '').trim() : '';
      if (rowUid) continue; // already has a UID — never match this row by email
      if (String(rows[i][colMap.email]).trim().toLowerCase() === wantEmail) return i + 2;
    }
  }
  return -1;
}

function _rowToObject_(sheet, colMap, row) {
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const obj = {};
  for (const key in colMap) obj[key] = values[colMap[key]];
  return obj;
}

function _setField_(sheet, colMap, row, field, value) {
  if (colMap[field] === undefined) return; // column absent — skip rather than write to the wrong one
  sheet.getRange(row, colMap[field] + 1).setValue(value);
}

// Normalizes a raw row record (from _rowToObject_) into the profile shape the
// client expects. Shared by handleGetProfile and handleGoogleLogin so the two
// can never disagree on field names or the Date->'yyyy-MM-dd' DOB conversion.
function _profileFromRow_(rec) {
  return {
    name: String(rec.name || ''),
    dob: (rec.dob instanceof Date)
      ? Utilities.formatDate(rec.dob, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(rec.dob || ''),
    phone: String(rec.phone || ''),
    city: String(rec.city || ''),
    area: String(rec.area || ''),
    sanghCode: String(rec.sanghCode || ''),
    email: String(rec.email || '')
  };
}

// ---- ACTION: get_sanghs ----
function handleGetSanghs() {
  const sheet = _sanghSheet_();
  if (!sheet) return { success: false, error: 'sangh_sheet_not_found' };

  const colMap = _headerMap_(sheet, SANGH_COLUMNS);
  if (colMap.code === undefined) return { success: false, error: 'code_column_not_found' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, sanghs: [] };

  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const sanghs = [];
  rows.forEach(function (r) {
    const code = String(r[colMap.code] || '').trim();
    if (!code) return; // skip blank rows
    sanghs.push({
      code: code,
      name: colMap.name !== undefined ? String(r[colMap.name] || '').trim() : '',
      city: colMap.city !== undefined ? String(r[colMap.city] || '').trim() : ''
    });
  });
  return { success: true, sanghs: sanghs };
}

// ---- ACTION: get_stats ----
// Public, aggregate-only counts for the landing page — never returns a uid,
// name, email, or sangh row, so it's safe to call before anyone signs in.
// `users` excludes admin rows and rows with a blank uid, so the number means
// "sadhaks using the app", not "rows in the sheet".
function handleGetStats() {
  const stats = { users: 0, sanghs: 0 };

  const usersSheet = _usersSheet_();
  if (usersSheet) {
    const colMap = _headerMap_(usersSheet, USER_COLUMNS);
    const lastRow = usersSheet.getLastRow();
    if (lastRow >= 2 && colMap.uid !== undefined) {
      const rows = usersSheet.getRange(2, 1, lastRow - 1, usersSheet.getLastColumn()).getValues();
      rows.forEach(function (r) {
        const uid = String(r[colMap.uid] || '').trim();
        if (!uid) return; // skip blank rows
        const role = colMap.role !== undefined ? String(r[colMap.role] || '').trim().toLowerCase() : '';
        if (role === 'admin') return;
        stats.users++;
      });
    }
  }

  const sanghSheet = _sanghSheet_();
  if (sanghSheet) {
    const colMap = _headerMap_(sanghSheet, SANGH_COLUMNS);
    const lastRow = sanghSheet.getLastRow();
    if (lastRow >= 2 && colMap.code !== undefined) {
      const rows = sanghSheet.getRange(2, 1, lastRow - 1, sanghSheet.getLastColumn()).getValues();
      rows.forEach(function (r) {
        const code = String(r[colMap.code] || '').trim();
        if (code) stats.sanghs++;
      });
    }
  }

  return { success: true, users: stats.users, sanghs: stats.sanghs };
}

// ---- ACTION: google_login ----
// Returns role/sanghCodes/registered/profile. Never creates a row —
// registration does that.
//
// `profile` piggybacks the full row (already loaded for role/sanghCodes) onto
// every login response so the client can sync Sheet edits — including a
// changed Sangh Code — WITHOUT a second request. This is what makes the
// Sheet the live source of truth rather than only mattering at registration.
//
// To make someone an ADMIN: add a row in Users with their UID (or Email),
// set Role = admin, and put the sangh codes they manage in "Sangh Codes"
// as a comma-separated list (e.g. SNG001,SNG002).
function handleGoogleLogin(params) {
  params = params || {}; // tolerate being run bare from the editor
  const sheet = _usersSheet_();
  if (!sheet) return { success: false, error: 'users_sheet_not_found' };

  const colMap = _headerMap_(sheet, USER_COLUMNS);
  const row = _findUserRow_(sheet, colMap, params.uid, params.email);
  if (row === -1) return { success: true, role: 'user', sanghCodes: [], registered: false, profile: null };

  const rec = _rowToObject_(sheet, colMap, row);
  const role = String(rec.role || 'user').trim().toLowerCase() === 'admin' ? 'admin' : 'user';
  const ownCode = String(rec.sanghCode || '').trim();

  let sanghCodes = String(rec.sanghCodes || '')
    .split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  if (!sanghCodes.length && ownCode) sanghCodes = [ownCode];

  // Backfill the UID if this row was matched by email only, so later lookups hit
  // the fast UID path and stay stable if the email ever changes.
  if (colMap.uid !== undefined && params.uid && !String(rec.uid || '').trim()) {
    _setField_(sheet, colMap, row, 'uid', params.uid);
  }

  return {
    success: true, role: role, sanghCodes: sanghCodes, registered: !!ownCode,
    profile: _profileFromRow_(rec)
  };
}

// ---- ACTION: register ----
function handleRegister(params) {
  params = params || {}; // tolerate being run bare from the editor
  // Never create an empty row: without a uid or email there is nothing to key
  // the row on, and running this bare from the editor would otherwise append
  // a blank row to the sheet on every Run.
  if (!String(params.uid || '').trim() && !String(params.email || '').trim()) {
    return { success: false, error: 'missing_uid_and_email' };
  }
  const sheet = _usersSheet_();
  if (!sheet) return { success: false, error: 'users_sheet_not_found' };

  const colMap = _headerMap_(sheet, USER_COLUMNS);
  let row = _findUserRow_(sheet, colMap, params.uid, params.email);
  if (row === -1) {
    // Upsert: target the first free row, then fill it cell-by-cell via the header
    // map. appendRow([]) is avoided because an empty array throws, and writing
    // past the grid's row count would be out of bounds — so grow it if needed.
    row = sheet.getLastRow() + 1;
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  }

  _setField_(sheet, colMap, row, 'uid', params.uid || '');
  _setField_(sheet, colMap, row, 'name', params.name || '');
  _setField_(sheet, colMap, row, 'email', params.email || '');
  _setField_(sheet, colMap, row, 'dob', params.dob || '');
  _setField_(sheet, colMap, row, 'gender', params.gender || '');
  _setField_(sheet, colMap, row, 'phone', params.phone || '');
  _setField_(sheet, colMap, row, 'city', params.city || '');
  _setField_(sheet, colMap, row, 'area', params.area || '');
  _setField_(sheet, colMap, row, 'sanghCode', params.sanghCode || '');
  _setField_(sheet, colMap, row, 'registeredAt', new Date().toISOString());

  // Only written when it validates — an invalid/oversized value from a client
  // bug is skipped rather than corrupting the cell or blocking registration.
  if (params.photo && _isValidPhotoDataUrl_(params.photo)) {
    _setPhotoCell_(sheet, colMap, row, params.photo);
  }

  // Don't clobber an existing Role (an admin re-registering must stay an admin).
  if (colMap.role !== undefined && !String(sheet.getRange(row, colMap.role + 1).getValue() || '').trim()) {
    _setField_(sheet, colMap, row, 'role', 'user');
  }

  return { success: true };
}

// ---- ACTION: get_sangh_users ----
function handleGetSanghUsers(params) {
  params = params || {}; // tolerate being run bare from the editor
  const sheet = _usersSheet_();
  if (!sheet) return { success: false, error: 'users_sheet_not_found' };

  const colMap = _headerMap_(sheet, USER_COLUMNS);
  if (colMap.sanghCode === undefined) return { success: true, users: [] };

  const wanted = (params.sanghCodes || []).map(function (c) { return String(c).trim().toLowerCase(); });
  if (!wanted.length) return { success: true, users: [] };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, users: [] };

  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const users = [];
  rows.forEach(function (r) {
    const code = String(r[colMap.sanghCode] || '').trim().toLowerCase();
    if (!code || wanted.indexOf(code) === -1) return;
    const uid = colMap.uid !== undefined ? String(r[colMap.uid] || '').trim() : '';
    if (!uid) return; // the client keys off uid; a row without one is unusable
    users.push({
      uid: uid,
      name: colMap.name !== undefined ? String(r[colMap.name] || '').trim() : '',
      sanghCode: colMap.sanghCode !== undefined ? String(r[colMap.sanghCode] || '').trim() : ''
    });
  });
  return { success: true, users: users };
}

// ---- ACTION: get_profiles ----
// Lists every profile (the primary plus any added ones) under one Google
// account, so the app's profile switcher always reflects the Sheet — the
// master — rather than drifting from whatever Firebase happens to cache.
// A profile's row UID is either the bare Google UID (primary) or
// "{googleUid}__pN" (2nd-5th) — this must stay in sync with PROFILE_SEP in
// auth.js.
function handleGetProfiles(params) {
  params = params || {}; // tolerate being run bare from the editor
  const baseUid = String(params.baseUid || '').trim();
  if (!baseUid) return { success: false, error: 'missing_base_uid' };

  const sheet = _usersSheet_();
  if (!sheet) return { success: false, error: 'users_sheet_not_found' };

  const colMap = _headerMap_(sheet, USER_COLUMNS);
  if (colMap.uid === undefined) return { success: true, profiles: [] };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, profiles: [] };

  const prefix = baseUid + '__p';
  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const profiles = [];
  rows.forEach(function (r) {
    const rowUid = String(r[colMap.uid] || '').trim();
    if (!rowUid) return;
    if (rowUid !== baseUid && rowUid.indexOf(prefix) !== 0) return;
    const sanghCode = colMap.sanghCode !== undefined ? String(r[colMap.sanghCode] || '').trim() : '';
    profiles.push({
      profileId: rowUid,
      name: colMap.name !== undefined ? String(r[colMap.name] || '').trim() : '',
      sanghCode: sanghCode,
      registered: !!sanghCode
    });
  });
  return { success: true, profiles: profiles };
}

// ---- ACTION: get_profile ----
function handleGetProfile(params) {
  params = params || {}; // tolerate being run bare from the editor
  const sheet = _usersSheet_();
  if (!sheet) return { success: false, error: 'users_sheet_not_found' };

  const colMap = _headerMap_(sheet, USER_COLUMNS);
  const row = _findUserRow_(sheet, colMap, params.uid, params.email);
  if (row === -1) return { success: false, error: 'not_found' };

  const rec = _rowToObject_(sheet, colMap, row);
  return { success: true, profile: _profileFromRow_(rec) };
}

// ---- ACTION: update_profile ----
function handleUpdateProfile(params) {
  params = params || {}; // tolerate being run bare from the editor
  const sheet = _usersSheet_();
  if (!sheet) return { success: false, error: 'users_sheet_not_found' };

  const colMap = _headerMap_(sheet, USER_COLUMNS);
  const row = _findUserRow_(sheet, colMap, params.uid, params.email);
  if (row === -1) return { success: false, error: 'not_found' };

  PROFILE_EDITABLE_FIELDS.forEach(function (field) {
    if (!(field in params)) return; // not sent — leave the existing value alone
    _setField_(sheet, colMap, row, field, params[field]);
  });
  return { success: true };
}

// ---- ACTION: get_photo ----
// Deliberately its OWN action, never folded into _profileFromRow_/get_profile
// — google_login and get_sangh_users both call _profileFromRow_ (or similar
// row reads) on every login and every admin roster load, and neither should
// ever drag a ~20KB base64 image along for the ride.
// Request:  { action: 'get_photo', uid }
// Response: { success: true, photo: '' | 'data:image/...' }
function handleGetPhoto(params) {
  params = params || {};
  const sheet = _usersSheet_();
  if (!sheet) return { success: false, error: 'users_sheet_not_found' };

  const colMap = _headerMap_(sheet, USER_COLUMNS);
  const row = _findUserRow_(sheet, colMap, params.uid, params.email);
  if (row === -1) return { success: false, error: 'not_found' };

  // Read from 'Photo Data', not 'Photo' — a cell holding a CellImage returns
  // an object from getValue(), and its source URL is not retrievable.
  if (colMap.photoData !== undefined) {
    const data = sheet.getRange(row, colMap.photoData + 1).getValue();
    if (typeof data === 'string' && data.indexOf('data:image') === 0) {
      return { success: true, photo: data };
    }
  }

  // Legacy fallback: rows written before the split still carry raw base64 in
  // 'Photo'. Anything else there (i.e. an actual CellImage object) is not a
  // string and correctly falls through to ''.
  if (colMap.photo !== undefined) {
    const legacy = sheet.getRange(row, colMap.photo + 1).getValue();
    if (typeof legacy === 'string' && legacy.indexOf('data:image') === 0) {
      return { success: true, photo: legacy };
    }
  }

  return { success: true, photo: '' };
}

// ---- ACTION: update_photo ----
// Request:  { action: 'update_photo', uid, photo: 'data:image/jpeg;base64,...' }
// Response: { success: true } or { success: false, error: '...' }
function handleUpdatePhoto(params) {
  params = params || {};
  if (!_isValidPhotoDataUrl_(params.photo)) {
    return { success: false, error: 'invalid_photo' };
  }

  const sheet = _usersSheet_();
  if (!sheet) return { success: false, error: 'users_sheet_not_found' };

  const colMap = _headerMap_(sheet, USER_COLUMNS);
  // 'Photo Data' is the one that actually must exist — it's what get_photo
  // serves back. The visible 'Photo' image column is a nice-to-have.
  if (colMap.photoData === undefined && colMap.photo === undefined) {
    return { success: false, error: 'photo_column_not_found' };
  }

  const row = _findUserRow_(sheet, colMap, params.uid, params.email);
  if (row === -1) return { success: false, error: 'not_found' };

  _setPhotoCell_(sheet, colMap, row, params.photo);
  return { success: true };
}

// ---- ROUTER ----
function routeAction(params) {
  const action = params && params.action;
  switch (action) {
    case 'google_login':    return handleGoogleLogin(params);
    case 'get_sanghs':      return handleGetSanghs();
    case 'get_stats':       return handleGetStats();
    case 'register':        return handleRegister(params);
    case 'get_sangh_users': return handleGetSanghUsers(params);
    case 'get_profiles':    return handleGetProfiles(params);
    case 'get_profile':     return handleGetProfile(params);
    case 'update_profile':  return handleUpdateProfile(params);
    case 'get_photo':       return handleGetPhoto(params);
    case 'update_photo':    return handleUpdatePhoto(params);
    default:                return { success: false, error: 'unknown_action: ' + action };
  }
}

function _respond_(result, callback) {
  const text = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

function _parseParams_(e, body) {
  if (body) { try { return JSON.parse(body); } catch (err) { /* fall through */ } }
  if (e && e.parameter && e.parameter.payload) {
    try { return JSON.parse(e.parameter.payload); } catch (err) { /* fall through */ } }
  return (e && e.parameter) || {};
}

function doPost(e) {
  try {
    const params = _parseParams_(e, e && e.postData && e.postData.contents);
    return _respond_(routeAction(params), e && e.parameter && e.parameter.callback);
  } catch (err) {
    return _respond_({ success: false, error: String(err) }, e && e.parameter && e.parameter.callback);
  }
}

// Serves the client's JSONP fallback (auth.js _fetchViaJsonp), which sends
// ?callback=...&payload=<json>. Calls routeAction directly — it must NOT call
// doPost, since e.postData doesn't exist on a GET.
function doGet(e) {
  try {
    const params = _parseParams_(e, null);
    return _respond_(routeAction(params), e && e.parameter && e.parameter.callback);
  } catch (err) {
    return _respond_({ success: false, error: String(err) }, e && e.parameter && e.parameter.callback);
  }
}

// ---- TESTS: run these from the editor (Run button) before touching the app ----
function testGetSanghs() {
  const r = handleGetSanghs();
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

function testSetup() {
  const ss = _ss_();
  Logger.log('Spreadsheet: ' + (ss ? ss.getName() : 'NULL — set SPREADSHEET_ID at the top'));
  if (ss) Logger.log('Sheets: ' + ss.getSheets().map(function (s) { return s.getName(); }).join(', '));
  Logger.log('Sangh sheet found: ' + (_sanghSheet_() ? 'yes' : 'NO'));
  Logger.log('Users sheet found/created: ' + (_usersSheet_() ? 'yes' : 'NO'));
  Logger.log('get_sanghs -> ' + JSON.stringify(handleGetSanghs()));
}

// ---- ONE-TIME MIGRATION ----
// Run this ONCE from the editor after adding the 'Photo Data' column, to
// convert rows that already hold raw base64 text in 'Photo' into a real
// in-cell image + a 'Photo Data' entry.
//
// Safe to re-run: rows already converted are skipped, because a converted
// 'Photo' cell no longer returns a string from getValue().
function migratePhotos() {
  const sheet = _usersSheet_();
  if (!sheet) { Logger.log('Users sheet not found'); return; }

  const colMap = _headerMap_(sheet, USER_COLUMNS);
  if (colMap.photo === undefined) { Logger.log('No "Photo" column found'); return; }
  if (colMap.photoData === undefined) {
    Logger.log('No "Photo Data" column found — add that header first, then re-run.');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('No data rows'); return; }

  let converted = 0;
  let skipped = 0;
  for (let row = 2; row <= lastRow; row++) {
    const value = sheet.getRange(row, colMap.photo + 1).getValue();
    if (typeof value !== 'string' || value.indexOf('data:image') !== 0) { skipped++; continue; }
    if (!_isValidPhotoDataUrl_(value)) {
      Logger.log('Row ' + row + ': photo present but invalid/oversized — left untouched.');
      skipped++;
      continue;
    }
    _setPhotoCell_(sheet, colMap, row, value);
    converted++;
  }
  Logger.log('migratePhotos done. Converted: ' + converted + ', skipped: ' + skipped);
}
