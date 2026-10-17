/**
 * QuickPoll — Google Sheets receiver.
 * Paste this whole file into Extensions → Apps Script of your Google Sheet,
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Each poll gets its own tab; each answer is one row; you get an email per answer.
 */

// ---- Settings ----------------------------------------------------------
var SEND_EMAIL = true;      // email me when a new answer arrives
var NOTIFY_EMAIL = '';      // leave empty to use your own Google account address
var IMAGE_FOLDER = 'QuickPoll images';   // Drive folder for images pasted in the builder
// ------------------------------------------------------------------------

var FIXED = ['Submitted', 'Name', 'Submission ID'];   // columns A, B, C (C is hidden)

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var key = e && e.parameter ? String(e.parameter.key || '') : '';
  return json_({
    ok: true, service: 'QuickPoll', sheet: ss ? ss.getName() : '',
    uploads: true, keyOk: !!key && key === uploadKey_()
  });
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  if (!data || data.website) return json_({ ok: true });              // honeypot: silently ignore bots
  if (data.action === 'upload') return json_(upload_(data));
  if (data.action) return json_({ ok: false, error: 'Unknown action' });
  if (!/^[a-z0-9]{4,16}$/.test(String(data.sid || '')) || !Array.isArray(data.answers)) {
    return json_({ ok: false, error: 'Bad data' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var ss, sheet, rowValues, duplicate = false;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    sheet = sheetFor_(ss, data);
    var subId = clip_(data.subId, 40);
    if (subId && isDuplicate_(sheet, subId)) {
      duplicate = true;
    } else {
      rowValues = writeRow_(sheet, data, subId);
    }
  } finally {
    lock.releaseLock();
  }

  if (!duplicate && SEND_EMAIL) {
    try { notify_(ss, sheet, data); } catch (err) { console.warn('Email failed: ' + err); }
  }
  return json_({ ok: true, duplicate: duplicate });
}

/* Find (or create) the tab for this poll. Tabs are named "<title> · <poll id>". */
function sheetFor_(ss, data) {
  var suffix = ' · ' + data.sid;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var n = sheets[i].getName();
    if (n.slice(-suffix.length) === suffix) return sheets[i];
  }
  var title = clip_(data.title, 200).replace(/[\[\]\*\?\/\\:]/g, ' ').replace(/\s+/g, ' ').trim() || 'Poll';
  var name = title.slice(0, 90) + suffix;
  var sh = ss.insertSheet(name, 0);
  sh.getRange(1, 1, 1, FIXED.length).setValues([FIXED]);
  styleHeader_(sh, 1, FIXED.length);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 140);
  sh.setColumnWidth(2, 140);
  sh.hideColumns(3);
  // remove the default empty "Sheet1" once we have a real tab
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('Лист1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  return sh;
}

function styleHeader_(sh, fromCol, count) {
  var r = sh.getRange(1, fromCol, 1, count);
  r.setFontWeight('bold').setBackground('#eef1ff').setWrap(true).setVerticalAlignment('top');
}

function isDuplicate_(sheet, subId) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var ids = sheet.getRange(2, 3, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] === subId) return true;
  return false;
}

function writeRow_(sheet, data, subId) {
  var lastCol = Math.max(sheet.getLastColumn(), FIXED.length);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var row = [];
  row[0] = new Date();
  row[1] = safe_(clip_(data.name, 200));
  row[2] = subId;

  data.answers.slice(0, 100).forEach(function (a) {
    var key = clip_(a.n, 4) + '. ' + clip_(a.q, 300);
    var col = colFor_(sheet, headers, key);
    row[col] = safe_(clip_(a.a, 5000));
    var note = clip_(a.note, 5000);
    if (note) {
      var ncol = colFor_(sheet, headers, key + ' — comment');
      row[ncol] = safe_(note);
    }
  });

  for (var i = 0; i < headers.length; i++) if (row[i] === undefined) row[i] = '';
  var r = sheet.getLastRow() + 1;
  sheet.getRange(r, 1, 1, headers.length).setValues([row.slice(0, headers.length)]);
  sheet.getRange(r, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange(r, 1, 1, headers.length).setWrap(true).setVerticalAlignment('top');
  return row;
}

/* Column index (0-based) for a header, creating the column if it doesn't exist yet. */
function colFor_(sheet, headers, key) {
  var idx = headers.indexOf(key);
  if (idx >= 0) return idx;
  headers.push(key);
  var col = headers.length;          // 1-based new column
  if (sheet.getMaxColumns() < col) sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
  sheet.getRange(1, col).setValue(key);
  styleHeader_(sheet, col, 1);
  sheet.setColumnWidth(col, /— comment$/.test(key) ? 220 : 180);
  return col - 1;
}

function notify_(ss, sheet, data) {
  var to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  if (!to) return;
  var url = ss.getUrl() + '#gid=' + sheet.getSheetId();
  var who = clip_(data.name, 200);
  var rows = data.answers.slice(0, 100).map(function (a) {
    var ans = clip_(a.a, 2000) || '—';
    var note = clip_(a.note, 2000);
    return '<tr><td style="padding:6px 12px 6px 0;color:#5b6372;vertical-align:top">' + esc_(clip_(a.n, 4) + '. ' + clip_(a.q, 300)) + '</td>' +
      '<td style="padding:6px 0;font-weight:600;vertical-align:top">' + esc_(ans) +
      (note ? '<div style="font-weight:400;font-style:italic;color:#5b6372">“' + esc_(note) + '”</div>' : '') + '</td></tr>';
  }).join('');
  var title = clip_(data.title, 200) || 'Poll';
  MailApp.sendEmail({
    to: to,
    subject: 'New answer: ' + title + (who ? ' — ' + who : ''),
    name: 'QuickPoll',
    htmlBody:
      '<div style="font-family:Arial,sans-serif;font-size:14px;color:#15181e">' +
      '<p style="margin:0 0 12px">New answer to <b>' + esc_(title) + '</b>' + (who ? ' from <b>' + esc_(who) + '</b>' : '') + '.</p>' +
      '<table style="border-collapse:collapse;font-size:14px">' + rows + '</table>' +
      '<p style="margin:16px 0 0"><a href="' + url + '" style="color:#3b5bfd">Open the sheet →</a></p></div>'
  });
}

/* ---- Images pasted in the builder → Drive folder "QuickPoll images" ---- */
function upload_(data) {
  if (!data.key || String(data.key) !== uploadKey_()) return { ok: false, error: 'Wrong upload key — copy it again from the script log' };
  var m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(String(data.data || ''));
  if (!m) return { ok: false, error: 'Only PNG, JPG, GIF or WebP images' };
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 10 * 1024 * 1024) return { ok: false, error: 'Image is too big (max 10 MB)' };
  var ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[m[1]];
  var base = clip_(data.name, 80).replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\- ]+/g, '').trim() || 'image';
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm-ss');
  var file = imageFolder_().createFile(Utilities.newBlob(bytes, m[1], stamp + ' ' + base + '.' + ext));
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    file.setTrashed(true);
    return { ok: false, error: 'Google Drive refused to make the image public (your Workspace admin may block link sharing)' };
  }
  var id = file.getId();
  return { ok: true, id: id, url: 'https://lh3.googleusercontent.com/d/' + id, fallback: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1600' };
}

function imageFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('IMAGE_FOLDER_ID');
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (err) { /* recreate below */ }
  }
  var folder = DriveApp.createFolder(IMAGE_FOLDER);
  props.setProperty('IMAGE_FOLDER_ID', folder.getId());
  return folder;
}

/* A secret that only you know: the builder needs it to upload images. Created once, kept in script properties. */
function uploadKey_() {
  var props = PropertiesService.getScriptProperties();
  var k = props.getProperty('UPLOAD_KEY');
  if (!k) {
    k = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('UPLOAD_KEY', k);
  }
  return k;
}

/* Optional clean-up: move images older than N days to the Drive trash. Run it by hand (▶ Run) whenever you like. */
function cleanupOldImages() {
  var DAYS = 30;
  var limit = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
  var files = imageFolder_().getFiles(), n = 0;
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated() < limit) { f.setTrashed(true); n++; }
  }
  console.log('Moved ' + n + ' old image(s) to the trash.');
}

/* Run this from the editor (▶ Run) to grant permissions and see your upload key. */
function authorize() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folder = imageFolder_();
  console.log('Sheet: ' + ss.getName() + ' · emails left today: ' + MailApp.getRemainingDailyQuota() +
    ' · notifications go to: ' + (NOTIFY_EMAIL || Session.getEffectiveUser().getEmail()));
  console.log('Images folder on your Drive: ' + folder.getName() + ' — ' + folder.getUrl());
  console.log('UPLOAD KEY (paste it in the builder → ⚙ Settings): ' + uploadKey_());
}

// ---- helpers ----
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function clip_(v, max) {
  if (v === undefined || v === null) return '';
  v = String(v);
  return v.length > max ? v.slice(0, max) : v;
}
/* Prevent text that starts with = + - @ from being treated as a formula. */
function safe_(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
