// ============================================================
// MyNiyam — Profile Get/Update + Sangh List additions for Apps Script
//
// This file is NOT loaded by the web app. It is source-of-record for backend
// code that must be pasted into your existing Apps Script project (the one
// deployed behind the /exec URL in auth.js) and redeployed.
//
// After pasting: use "Manage deployments" -> edit the EXISTING deployment
// (do not create a new one, or the /exec URL will change and auth.js:4 will
// need to be updated to match). Also check "Who has access" is set to
// "Anyone" — anything stricter makes Apps Script omit CORS headers entirely,
// which is what was breaking EVERY action, not just get_sanghs: fetch()
// calls for google_login/register/get_sangh_users were failing the exact
// same way (visible in the browser console as a CORS error on /exec). The
// doGet(e) added below gives the client's JSONP fallback a way around that
// regardless of this setting, but fixing "Who has access" is still the real,
// permanent fix.
// ============================================================

// ---- CONFIG: adjust these two blocks to match your actual Sheet ----

// The exact name of the sheet/tab that holds one row per registered user.
const PROFILE_SHEET_NAME = 'Users'; // <-- set this to your real sheet/tab name

// Maps each logical field to the EXACT column header text in row 1 of that
// sheet (matched case-insensitively, whitespace-trimmed). Edit the
// right-hand strings to match your real headers.
const PROFILE_COLUMNS = {
  uid: 'UID',
  name: 'Name',
  dob: 'DOB',
  phone: 'Phone',
  city: 'City',
  area: 'Area',
  sanghCode: 'Sangh Code',
  email: 'Email',
};

// Fields the app is allowed to update via update_profile. Sangh, name, dob,
// email and uid are intentionally excluded from this list — even if a
// malicious client sends them, handleUpdateProfile() below ignores anything
// not in this list. This whitelist, not the client UI, is what actually
// enforces "the user cannot change their sangh".
const PROFILE_EDITABLE_FIELDS = ['phone', 'city', 'area'];

// ---- Header -> column index map, built fresh on every call so a header ----
// ---- reordered in the Sheet is picked up automatically.                ----
function _profileHeaderMap_(sheet) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const byHeaderText = {};
  headerRow.forEach(function (h, i) {
    byHeaderText[String(h).trim().toLowerCase()] = i; // 0-based column index
  });
  const resolved = {};
  for (const key in PROFILE_COLUMNS) {
    const headerText = String(PROFILE_COLUMNS[key]).trim().toLowerCase();
    if (headerText in byHeaderText) resolved[key] = byHeaderText[headerText];
  }
  return resolved;
}

function _findProfileRow_(sheet, colMap, uid) {
  if (colMap.uid === undefined) return -1; // uid column not found — can't look anyone up
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1; // header only, no data rows yet
  const uidValues = sheet.getRange(2, colMap.uid + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < uidValues.length; i++) {
    if (String(uidValues[i][0]).trim() === String(uid).trim()) return i + 2; // 1-based sheet row
  }
  return -1;
}

// ---- action: get_profile ----
// Request:  { action: 'get_profile', uid }
// Response: { success: true, profile: { name, dob, phone, city, area, sanghCode, email } }
//        or { success: false, error: 'not_found' | 'sheet_not_found' }
function handleGetProfile(params) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(PROFILE_SHEET_NAME);
  if (!sheet) return { success: false, error: 'sheet_not_found' };

  const colMap = _profileHeaderMap_(sheet);
  const row = _findProfileRow_(sheet, colMap, params.uid);
  if (row === -1) return { success: false, error: 'not_found' };

  const rowValues = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const profile = {};
  for (const key in colMap) {
    profile[key] = rowValues[colMap[key]];
  }
  return { success: true, profile: profile };
}

// ---- action: update_profile ----
// Request:  { action: 'update_profile', uid, phone, city, area }
//           (any other field in the payload, e.g. sanghCode, is ignored server-side)
// Response: { success: true } or { success: false, error: '...' }
function handleUpdateProfile(params) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(PROFILE_SHEET_NAME);
  if (!sheet) return { success: false, error: 'sheet_not_found' };

  const colMap = _profileHeaderMap_(sheet);
  const row = _findProfileRow_(sheet, colMap, params.uid);
  if (row === -1) return { success: false, error: 'not_found' };

  PROFILE_EDITABLE_FIELDS.forEach(function (field) {
    if (colMap[field] === undefined) return; // column not found in sheet — skip safely
    if (!(field in params)) return; // field not sent by client — leave existing value alone
    sheet.getRange(row, colMap[field] + 1).setValue(params[field]);
  });

  return { success: true };
}

// ============================================================
// Sangh List (sheet named "Sanghs", columns: Code, Name, City)
//
// Fixes the registration-form dropdown, which was showing empty because the
// client's get_sanghs request had no matching backend branch — and,
// separately, because of the CORS issue described at the top of this file.
// ============================================================

// Looked up by NAME first (confirmed sheet name: "Sanghs"), falling back to
// position (second sheet, 0-indexed) if that name isn't found — so this
// still works even if the tab gets renamed later.
const SANGH_SHEET_NAME = 'Sanghs';

// Maps each logical field to the EXACT column header text in row 1 of the
// sangh list — matched case-insensitively, whitespace-trimmed.
const SANGH_COLUMNS = {
  code: 'Code',
  name: 'Name',
  city: 'City',
};

function _getSanghSheet_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(SANGH_SHEET_NAME) || ss.getSheets()[1] || null;
}

// ---- action: get_sanghs ----
// Request:  { action: 'get_sanghs' }  (no uid needed)
// Response: { success: true, sanghs: [{ code, name, city }, ...] }
//        or { success: false, error: 'sheet_not_found' | 'code_column_not_found' }
function handleGetSanghs() {
  const sheet = _getSanghSheet_();
  if (!sheet) return { success: false, error: 'sheet_not_found' };

  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const byHeaderText = {};
  headerRow.forEach(function (h, i) {
    byHeaderText[String(h).trim().toLowerCase()] = i; // 0-based column index
  });
  const colMap = {};
  for (const key in SANGH_COLUMNS) {
    const headerText = String(SANGH_COLUMNS[key]).trim().toLowerCase();
    if (headerText in byHeaderText) colMap[key] = byHeaderText[headerText];
  }
  if (colMap.code === undefined) return { success: false, error: 'code_column_not_found' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, sanghs: [] }; // header only, no data rows yet

  const dataRows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const sanghs = [];
  dataRows.forEach(function (row) {
    const code = String(row[colMap.code] || '').trim();
    if (!code) return; // skip blank rows
    sanghs.push({
      code: code,
      name: colMap.name !== undefined ? String(row[colMap.name] || '').trim() : '',
      city: colMap.city !== undefined ? String(row[colMap.city] || '').trim() : '',
    });
  });

  return { success: true, sanghs: sanghs };
}

// Run this manually from the Apps Script editor (select testGetSanghs in the
// function dropdown, then Run) to confirm the sheet reads correctly BEFORE
// testing through the browser at all. Check View -> Logs for the result.
function testGetSanghs() {
  const result = handleGetSanghs();
  Logger.log(JSON.stringify(result));
  return result;
}

// ============================================================
// JSONP-aware response wrapper + a doGet(e) that works for EVERY action
// ============================================================

// Wraps a plain result object as JSONP (callback(...)) when the request
// carried a `callback` query param, or as plain JSON otherwise. Use this for
// get_profile/update_profile/get_sanghs — see WIRING below for how the 3
// pre-existing actions get the same treatment without touching their logic.
function respond_(result, e) {
  const text = JSON.stringify(result);
  const callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

// The client's JSONP fallback (auth.js: _fetchViaJsonp) sends EVERY action —
// including the pre-existing google_login/register/get_sangh_users — as a GET
// with ?callback=...&payload=<JSON>. Rather than re-implementing those three
// actions' logic here (which would risk diverging from your real
// implementation and is safer not to guess at), this doGet reconstructs a
// POST-shaped event and calls your EXISTING doPost(e) directly, then
// re-wraps whatever it returns as JSONP.
//
// IMPORTANT: if your project ALREADY defines a doGet(e) function anywhere,
// delete that one (or merge its logic in here) — you cannot have two.
function doGet(e) {
  const fakeEvent = { parameter: e.parameter, postData: { contents: (e.parameter && e.parameter.payload) || '{}' } };
  const output = doPost(fakeEvent); // your existing doPost — must return a ContentService TextOutput
  const text = output.getContent();
  const callback = e.parameter && e.parameter.callback;
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// WIRING — the only edits needed in your EXISTING doPost(e):
//
//   if (action === 'get_profile')    return respond_(handleGetProfile(params), e);
//   if (action === 'update_profile') return respond_(handleUpdateProfile(params), e);
//   if (action === 'get_sanghs')     return respond_(handleGetSanghs(), e);
//
// Add these alongside your current branches for 'google_login' / 'register' /
// 'get_sangh_users' — leave those three completely untouched. The doGet(e)
// above then makes ALL SIX actions work over JSONP automatically, since it
// simply forwards to your doPost.
// ============================================================
