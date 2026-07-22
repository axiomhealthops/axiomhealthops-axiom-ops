/**
 * EdemaCare garment ingest — paste this into the workbook's Apps Script
 * project, BELOW the existing onFormSubmit. Do not delete what is there.
 *
 * Setup lives in docs/GARMENT_SHEET_LIVE_LINK.md. In short:
 *   Script Properties: EDEMACARE_INGEST_URL, EDEMACARE_INGEST_SECRET
 *   onFormSubmit(e): add as the FIRST line of the body ->
 *     try { pushToEdemaCare(e.range.getSheet(), e.range.getRow()); } catch (err) { console.error(err); }
 *   Triggers: add an "On edit" trigger for onGarmentEdit
 *
 * Columns are read by HEADER TEXT, never by position. The LE sheet has 51
 * columns and UE has 49 and they are not in the same order, so position
 * mapping silently writes the wrong value into the wrong field. One real
 * trap this avoids: the LE address header contains the word "delivery"
 * ("...not deemed safe for delivery of garment..."), so a loose match on
 * "delivery" alone grabs the address column.
 */

var GARMENT_SHEETS = ['LE garments', 'UE garments'];

/** First header containing ALL needles. Each column is claimed once. */
function _resolve(headers, claimed) {
  var lower = headers.map(function (h) {
    return String(h == null ? '' : h).replace(/\s+/g, ' ').trim().toLowerCase();
  });
  return function () {
    var needles = Array.prototype.slice.call(arguments);
    for (var i = 0; i < lower.length; i++) {
      if (claimed[i]) continue;
      var ok = true;
      for (var n = 0; n < needles.length; n++) {
        if (lower[i].indexOf(needles[n]) === -1) { ok = false; break; }
      }
      if (ok) { claimed[i] = true; return i; }
    }
    return -1;
  };
}

function _iso(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString();
  var s = String(v == null ? '' : v).trim();
  return s;
}

/** Build the JSON payload for one row of a garment sheet. */
function _buildPayload(sheet, rowNumber) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(rowNumber, 1, 1, lastCol).getValues()[0];
  var claimed = {};
  var col = _resolve(headers, claimed);

  // Claim order matters: specific before loose.
  var c = {
    timestamp:      col('timestamp'),
    email:          col('email address'),
    clinician:      col('clinician name'),
    insurance:      col('insurance'),
    region:         col('region'),
    patient:        col('patient name'),
    loc:            col('current level of care'),
    frequency:      col('current frequency'),
    phase:          col('phase of care'),
    address:        col('mailing address'),
    orderType:      col('order type'),
    dosage:         col('dosage'),
    etiology:       col('etiology'),
    orderForm:      col('completed order form'),
    accessories:    col('additional accessories'),
    supervisor:     col('supervisory clinician'),
    requestDate:    col('request date'),
    questions:      col('questions and comments'),
    approverEmail:  col('approver email'),
    approvalStatus: col('approval status'),
    approvalNotes:  col('approval comments'),
    statusChanged:  col('status change date'),
    authNo:         col('auth#'),
    authDate:       col('auth date'),
    authNeeded:     col('auth needed'),
    orderNo:        col('order#'),
    orderPlaced:    col('date order was placed'),
    garmentCode:    col('garment code'),
    garmentCost:    col('garment cost'),
    delivery:       col('delivery date'),
    comments:       col('comments')
  };
  var g = function (i) { return i === -1 ? '' : values[i]; };

  var patient = String(g(c.patient) || '').replace(/\s+/g, ' ').trim();
  if (!patient) return null;   // nothing to key on; skip silently

  var notes = [g(c.questions), g(c.comments)]
    .map(function (x) { return String(x == null ? '' : x).trim(); })
    .filter(function (x) { return x; })
    .join(' | ');

  return {
    limb_type: sheet.getName().toUpperCase().indexOf('UE') === 0 ? 'UE' : 'LE',
    patient_name: patient,
    region: g(c.region),
    insurance: g(c.insurance),
    patient_address: g(c.address),
    clinician_name: g(c.clinician),
    clinician_email: g(c.email),
    approver_email: g(c.approverEmail),
    approver_name: g(c.supervisor),
    current_loc: g(c.loc),
    current_frequency: g(c.frequency),
    phase_of_care: g(c.phase),
    order_type: g(c.orderType),
    dosage: g(c.dosage),
    etiology: g(c.etiology),
    order_form_url: g(c.orderForm),
    additional_items: g(c.accessories),
    field_request_date: _iso(g(c.requestDate)),
    approval_status: g(c.approvalStatus),
    approval_comments: g(c.approvalNotes),
    status_change_date: _iso(g(c.statusChanged)),
    auth_number: g(c.authNo),
    auth_date: _iso(g(c.authDate)),
    auth_needed: g(c.authNeeded),
    order_number: g(c.orderNo),
    order_placed_date: _iso(g(c.orderPlaced)),
    garment_code: g(c.garmentCode),
    garment_cost: g(c.garmentCost),
    // Sent raw: this column holds POD filenames far more often than
    // dates. The app decides what is a date and what is a proof
    // reference, so the rule lives in one place.
    delivery_raw: g(c.delivery),
    notes: notes,
    submitted_at: _iso(g(c.timestamp))
  };
}

/** POST one row. Returns the HTTP status code. */
function pushToEdemaCare(sheet, rowNumber) {
  if (GARMENT_SHEETS.indexOf(sheet.getName()) === -1) return 0;   // not a garment sheet

  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('EDEMACARE_INGEST_URL');
  var secret = props.getProperty('EDEMACARE_INGEST_SECRET');
  if (!url || !secret) {
    console.error('EDEMACARE_INGEST_URL / EDEMACARE_INGEST_SECRET not set in Script Properties');
    return 0;
  }

  var payload = _buildPayload(sheet, rowNumber);
  if (!payload) return 0;

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Garment-Ingest-Secret': secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true   // never let a failed push break the sheet
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    console.error('EdemaCare ingest failed (' + code + ') for row ' + rowNumber + ': ' + res.getContentText());
  }
  return code;
}

/**
 * On-edit trigger. Auth numbers, order numbers, garment codes and costs
 * are typed straight into the sheet rather than submitted through the
 * form, so onFormSubmit alone would never see the half of the lifecycle
 * that matters most for reporting.
 */
function onGarmentEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (GARMENT_SHEETS.indexOf(sheet.getName()) === -1) return;
    var row = e.range.getRow();
    if (row < 2) return;                       // header edit
    pushToEdemaCare(sheet, row);
  } catch (err) {
    console.error('onGarmentEdit: ' + err);
  }
}

/**
 * One-time (or repeatable) full push of every row in both sheets.
 * Safe to re-run: the app keys on patient + request date, so rows update
 * rather than duplicate.
 */
function backfillAllGarmentOrders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sent = 0, skipped = 0, failed = 0;

  for (var s = 0; s < GARMENT_SHEETS.length; s++) {
    var sheet = ss.getSheetByName(GARMENT_SHEETS[s]);
    if (!sheet) { console.log('sheet not found: ' + GARMENT_SHEETS[s]); continue; }
    var lastRow = sheet.getLastRow();
    for (var r = 2; r <= lastRow; r++) {
      var code = pushToEdemaCare(sheet, r);
      if (code === 200) sent++;
      else if (code === 0) skipped++;
      else failed++;
      // Apps Script caps at ~6 minutes per execution and UrlFetch is
      // rate limited. A short pause keeps a 300-row backfill inside both.
      Utilities.sleep(120);
    }
  }
  console.log('backfill complete - sent ' + sent + ', skipped ' + skipped + ', failed ' + failed);
}

/**
 * RUN THIS FIRST.
 *
 * An Apps Script project is bound to ONE spreadsheet, and a project
 * titled "LE Garment" may well be attached to the LE response sheet
 * rather than the master workbook that holds both tabs. If so,
 * backfillAllGarmentOrders would silently push half the orders and
 * report "sheet not found" for the other half.
 *
 * This logs which spreadsheet the project is actually attached to, which
 * tabs it can see, and whether the two script properties are set — so
 * every assumption is checked before anything is written.
 */
function whereAmI() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    console.log('NOT BOUND to a spreadsheet. This is a standalone script project.');
    console.log('Fix: open the master workbook -> Extensions -> Apps Script, and paste this there instead.');
    return;
  }
  console.log('Spreadsheet : ' + ss.getName());
  console.log('URL         : ' + ss.getUrl());

  var names = ss.getSheets().map(function (s) { return s.getName(); });
  console.log('Tabs (' + names.length + '): ' + names.join(' | '));

  var missing = [];
  for (var i = 0; i < GARMENT_SHEETS.length; i++) {
    var want = GARMENT_SHEETS[i];
    var found = ss.getSheetByName(want);
    if (found) {
      console.log('OK   "' + want + '" found, ' + (found.getLastRow() - 1) + ' data rows');
    } else {
      missing.push(want);
      console.log('MISS "' + want + '" NOT in this spreadsheet');
    }
  }

  var props = PropertiesService.getScriptProperties();
  console.log('EDEMACARE_INGEST_URL    : ' + (props.getProperty('EDEMACARE_INGEST_URL') ? 'set' : 'NOT SET'));
  console.log('EDEMACARE_INGEST_SECRET : ' + (props.getProperty('EDEMACARE_INGEST_SECRET') ? 'set' : 'NOT SET'));

  if (missing.length === GARMENT_SHEETS.length) {
    console.log('');
    console.log('This project cannot see either garment tab. Paste the script into the');
    console.log('Apps Script project of the MASTER workbook instead.');
  } else if (missing.length) {
    console.log('');
    console.log('Only some tabs are visible. The backfill will cover what it can find and');
    console.log('report the rest as skipped - it will not fail, but it will be incomplete.');
  }
}

/** Push just the first data row of the LE sheet, and log the response. */
function testPushOneRow() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('LE garments');
  if (!sheet) { console.log('LE garments sheet not found'); return; }
  var code = pushToEdemaCare(sheet, 2);
  console.log('test push returned HTTP ' + code + ' (200 = success, 401 = secret mismatch, 503 = secret not set in Supabase)');
}
