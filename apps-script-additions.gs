// ============================================================
// MyNiyam — Profile Get/Update + Sangh List additions for Apps Script
//
// This file is NOT loaded by the web app. It is source-of-record for backend
// code that must be pasted into your existing Apps Script project (the one
// deployed behind the /exec URL in auth.js) and redeployed.
//
// After pasting: use "Manage deployments" -> edit the EXISTING deployment
// (do not create a new one, or the /exec URL will change and auth.js:4 will
// need to be updated to match).
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
// Sangh List (SECOND sheet of the workbook)
//
// Fixes the registration-form dropdown, which was showing empty because the
// client's get_sanghs request had no matching doGet(e)/doPost(e) branch.
// ============================================================

// Maps each logical field to the EXACT column header text in row 1 of the
// SECOND sheet/tab (the sangh list) — matched case-insensitively, whitespace-
// trimmed. Edit the right-hand strings to match your real headers.
const SANGH_COLUMNS = {
  code: 'Code',
  name: 'Name',
  city: 'City',
};

// ---- action: get_sanghs ----
// Request:  { action: 'get_sanghs' }  (no uid needed)
// Response: { success: true, sanghs: [{ code, name, city }, ...] }
//        or { success: false, error: 'sheet_not_found' | 'code_column_not_found' }
function handleGetSanghs() {
  const sheets = SpreadsheetApp.getActive().getSheets();
  const sheet = sheets[1]; // the SECOND sheet, 0-indexed
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

// ============================================================
// WIRING — add these lines to your existing action dispatcher(s). Match
// whatever response-wrapping helper your doPost/doGet already use for the
// other actions (e.g. ContentService.createTextOutput with JSON.stringify +
// .setMimeType(ContentService.MimeType.JSON)):
//
// In doPost(e) — alongside 'google_login' / 'register' / 'get_sangh_users':
//   if (action === 'get_profile')    return respond(handleGetProfile(params));
//   if (action === 'update_profile') return respond(handleUpdateProfile(params));
//   if (action === 'get_sanghs')     return respond(handleGetSanghs());
//
// In doGet(e) — the client no longer sends get_sanghs as a GET, but wiring it
// here too costs nothing and makes the action work regardless of method:
//   if (action === 'get_sanghs')     return respond(handleGetSanghs());
//
// ============================================================
