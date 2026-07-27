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
const USER_HEADERS = [
  'UID', 'Name', 'Email', 'DOB', 'Phone', 'City', 'Area',
  'Sangh Code', 'Role', 'Sangh Codes', 'Registered At'
];

// Logical field -> column header text (matched case-insensitively, trimmed).
const USER_COLUMNS = {
  uid: 'UID', name: 'Name', email: 'Email', dob: 'DOB', phone: 'Phone',
  city: 'City', area: 'Area', sanghCode: 'Sangh Code',
  role: 'Role', sanghCodes: 'Sangh Codes', registeredAt: 'Registered At'
};

const SANGH_COLUMNS = { code: 'Code', name: 'Name', city: 'City' };

// Only these may be written by update_profile. Sangh, name, dob, email and uid
// are excluded on purpose: even if a modified client sends them they are
// ignored here. This whitelist — not the client UI — is what actually enforces
// "the user cannot change their sangh".
const PROFILE_EDITABLE_FIELDS = ['phone', 'city', 'area'];

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
  // Fall back to email so a row created before the UID was known still matches.
  if (wantEmail && colMap.email !== undefined) {
    for (let i = 0; i < rows.length; i++) {
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

// ---- ACTION: google_login ----
// Returns role/sanghCodes/registered. Never creates a row — registration does that.
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
  if (row === -1) return { success: true, role: 'user', sanghCodes: [], registered: false };

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

  return { success: true, role: role, sanghCodes: sanghCodes, registered: !!ownCode };
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
  _setField_(sheet, colMap, row, 'phone', params.phone || '');
  _setField_(sheet, colMap, row, 'city', params.city || '');
  _setField_(sheet, colMap, row, 'area', params.area || '');
  _setField_(sheet, colMap, row, 'sanghCode', params.sanghCode || '');
  _setField_(sheet, colMap, row, 'registeredAt', new Date().toISOString());

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

// ---- ACTION: get_profile ----
function handleGetProfile(params) {
  params = params || {}; // tolerate being run bare from the editor
  const sheet = _usersSheet_();
  if (!sheet) return { success: false, error: 'users_sheet_not_found' };

  const colMap = _headerMap_(sheet, USER_COLUMNS);
  const row = _findUserRow_(sheet, colMap, params.uid, params.email);
  if (row === -1) return { success: false, error: 'not_found' };

  const rec = _rowToObject_(sheet, colMap, row);
  return {
    success: true,
    profile: {
      name: String(rec.name || ''),
      // Dates come back as Date objects; send YYYY-MM-DD so it round-trips into
      // the <input type="date"> and the client's DOB formatter.
      dob: (rec.dob instanceof Date)
        ? Utilities.formatDate(rec.dob, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(rec.dob || ''),
      phone: String(rec.phone || ''),
      city: String(rec.city || ''),
      area: String(rec.area || ''),
      sanghCode: String(rec.sanghCode || ''),
      email: String(rec.email || '')
    }
  };
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

// ---- ROUTER ----
function routeAction(params) {
  const action = params && params.action;
  switch (action) {
    case 'google_login':    return handleGoogleLogin(params);
    case 'get_sanghs':      return handleGetSanghs();
    case 'register':        return handleRegister(params);
    case 'get_sangh_users': return handleGetSanghUsers(params);
    case 'get_profile':     return handleGetProfile(params);
    case 'update_profile':  return handleUpdateProfile(params);
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
