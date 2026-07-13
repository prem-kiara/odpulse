// CSV ingestion for the two OD reports.
//
// File 1: Compressed Pool Report    — pipe-delimited, master customer data + pool snapshot fields.
// File 2: Interest Accrued Not Due  — comma-delimited, per-BOD accrued interest values.
//
// Join key: Pool "Loan number" == Accrued "Account Number" (10-digit loan account no.)

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const db = require("./db");

// ── Required column sets ───────────────────────────────────────────────────
// We validate these BEFORE opening the DB transaction so a wrong file fails
// fast with a clear error instead of silently inserting zero rows.
const POOL_REQUIRED_COLS = [
  "Loan number",
  "Office Name",
  "Member Name",
  "Principal Outstanding",
  "Current OD",
];
const ACCRUED_REQUIRED_COLS = [
  "Account Number",
  "Branch",
  "Principal Outstanding",
];

// ── helpers ────────────────────────────────────────────────────────────────
const num = (v) => {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/["]/g, "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ── Product-name remap ─────────────────────────────────────────────────
// Some source product codes have been consolidated in reporting. This map
// is applied at ingest time so upstream data using the OLD name still
// lands in the DB under the NEW canonical name. To retire another code
// in future, add its old → new entry here — no code changes needed
// downstream.
//
//   Daily_Installment → VM_GPL   (Vinnamgudi / Erode-HO daily-instalment
//                                  book folded into the VM Grameen PL line)
//   6L_Temp_18_24     → KMCL_STBL (temporary 6L @ 18% p.a. product folded
//                                   into the STBL family)
const PRODUCT_NAME_REMAP = {
  "Daily_Installment": "VM_GPL",
  "6L_Temp_18_24":     "KMCL_STBL",
};
const remapProductName = (v) => {
  if (v == null) return "";
  const s = String(v).replace(/^"|"$/g, "").trim();
  return PRODUCT_NAME_REMAP[s] || s;
};

const str = (v) => {
  if (v == null) return "";
  return String(v).replace(/^"|"$/g, "").trim();
};

// Read branches.json safely.
function readBranches(branchesFile) {
  try { return JSON.parse(fs.readFileSync(branchesFile, "utf8")); }
  catch { return []; }
}

// Atomically overwrite branches.json (write to temp then rename).
function writeBranchesAtomic(branchesFile, branches) {
  const tmp = branchesFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(branches, null, 2), "utf8");
  fs.renameSync(tmp, branchesFile);
}

// Append a single branch to branches.json if it isn't already present.
// Used by the per-row Overdue / Collections / Client-Period ingest flows
// that don't batch a `pendingBranches` array. Mutates the in-memory
// `branchRegistry` Set so subsequent rows in the same file skip the
// disk write. The on-disk write is atomic (temp file + rename). Empty
// branch names are silently ignored. Errors surface to the caller.
//
// TYPO PROTECTION: every auto-added branch is logged AND also appended to
// branches-autoadded-audit.json so admins can review what showed up. If a
// near-duplicate of an existing branch is detected (e.g. "Mahasaman" when
// "Mahasamam" exists), the row is added (so ingest doesn't fail) but
// FLAGGED for admin review in branches-pending-review.json. The dropdown
// keeps the new branch visible, but admins can see what to merge.
function addBranchIfMissing(branchesFile, branch, branchRegistry) {
  if (!branch) return;
  const trimmed = String(branch).trim();
  if (!trimmed) return;
  // Trailing-space / case-variant detection — these are almost certainly
  // typos rather than genuinely new branches.
  if (trimmed !== String(branch)) {
    console.warn(`[branches] auto-add SUSPICIOUS: input "${branch}" has surrounding whitespace; using "${trimmed}"`);
  }
  const key = trimmed.toLowerCase();
  if (branchRegistry.has(key)) return;
  branchRegistry.add(key);
  const existing = readBranches(branchesFile);
  if (existing.some(b => String(b).toLowerCase() === key)) return;

  // Fuzzy near-duplicate detection: collapse non-letter chars + lowercase,
  // then compare. "Mahasamam" vs "Mahasaman" → both → "mahasamam" / "mahasaman"
  // — Levenshtein distance 1. Flag pairs with distance ≤ 2 on names ≥ 4 chars.
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const ntrimmed = norm(trimmed);
  function lev(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const v = new Array(b.length + 1).fill(0).map((_, i) => i);
    for (let i = 0; i < a.length; i++) {
      let prev = i + 1;
      for (let j = 0; j < b.length; j++) {
        const cost = a[i] === b[j] ? 0 : 1;
        const cur = Math.min(v[j + 1] + 1, prev + 1, v[j] + cost);
        v[j] = prev;
        prev = cur;
      }
      v[b.length] = prev;
    }
    return v[b.length];
  }
  let nearMatch = null;
  if (ntrimmed.length >= 4) {
    for (const b of existing) {
      const nb = norm(b);
      if (!nb) continue;
      const d = lev(ntrimmed, nb);
      if (d > 0 && d <= 2) { nearMatch = b; break; }
    }
  }
  if (nearMatch) {
    console.warn(`[branches] auto-add NEAR-DUPLICATE: "${trimmed}" looks similar to existing "${nearMatch}" — flagging for admin review`);
    try {
      const reviewFile = branchesFile.replace(/branches\.json$/, "branches-pending-review.json");
      let review = [];
      try { review = JSON.parse(fs.readFileSync(reviewFile, "utf8")); } catch {}
      review.unshift({
        ts: new Date().toISOString(),
        added: trimmed,
        similarTo: nearMatch,
        action: "auto-added",
      });
      fs.writeFileSync(reviewFile, JSON.stringify(review.slice(0, 1000), null, 2), "utf8");
    } catch (e) {
      console.warn(`[branches] couldn't write review file: ${e.message}`);
    }
  }

  console.log(`[branches] auto-add: "${trimmed}"${nearMatch ? ` (NEAR "${nearMatch}" — review)` : ""}`);
  writeBranchesAtomic(branchesFile, existing.concat(trimmed));

  // Also write to an audit log of every auto-added branch.
  try {
    const auditFile = branchesFile.replace(/branches\.json$/, "branches-autoadded-audit.json");
    let audit = [];
    try { audit = JSON.parse(fs.readFileSync(auditFile, "utf8")); } catch {}
    audit.unshift({ ts: new Date().toISOString(), branch: trimmed, nearMatch });
    fs.writeFileSync(auditFile, JSON.stringify(audit.slice(0, 5000), null, 2), "utf8");
  } catch (e) {
    console.warn(`[branches] couldn't write audit file: ${e.message}`);
  }
}

// Validate required headers exist (case-insensitive, trim-insensitive).
// Returns the list of missing columns (empty = OK).
function missingColumns(firstRow, required) {
  if (!firstRow) return required.slice();
  const have = new Set(Object.keys(firstRow).map(k => String(k).trim().toLowerCase()));
  return required.filter(c => !have.has(c.toLowerCase()));
}

// Checkpoint WAL at the end of a large ingest to keep the -wal file from growing unbounded.
function checkpoint() {
  try { db.pragma("wal_checkpoint(TRUNCATE)"); }
  catch (err) { console.warn("[ingest] wal_checkpoint failed:", err.message); }
}

// ── Pool report ingestion ──────────────────────────────────────────────────
function ingestPool(fileContent, opts) {
  const { snapshotDate, branchesFile, uploadedBy, filename } = opts;

  // Some Finflux Pool Report exports include a "group label" row as line 1:
  //   ||||||||||...Installment 1||||Installment 2||||Installment 3...
  // This row marks where the repeating per-installment demand columns begin.
  // The REAL header row ("Loan number|Customer number|Member Name|...") is then
  // on line 2. If we feed this straight into csv-parse with columns:true, every
  // real column name becomes a DATA value and ingestion fails with
  // "missing required columns: Loan number, Member Name, ...".
  // Detect and strip that leading group-label row if present.
  let content = fileContent;
  const firstNewline = content.indexOf("\n");
  if (firstNewline > 0) {
    const firstLine = content.slice(0, firstNewline);
    const looksLikeGroupLabels =
      !/Loan\s*number/i.test(firstLine) && /Installment\s+\d+/i.test(firstLine);
    if (looksLikeGroupLabels) {
      console.log(`[ingestPool] detected group-label first line, stripping it before parse`);
      content = content.slice(firstNewline + 1);
    }
  }

  let rows;
  try {
    rows = parse(content, {
      delimiter: "|",
      quote: '"',
      columns: true,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    const e = new Error(`Could not parse pool report CSV: ${err.message}`);
    e.statusCode = 400;
    throw e;
  }

  if (rows.length === 0) {
    const e = new Error("Pool report contains no data rows.");
    e.statusCode = 400;
    throw e;
  }

  const missing = missingColumns(rows[0], POOL_REQUIRED_COLS);
  if (missing.length) {
    const e = new Error(
      `Pool report is missing required columns: ${missing.join(", ")}. ` +
      `Got: ${Object.keys(rows[0]).join(", ")}`
    );
    e.statusCode = 400;
    throw e;
  }

  // Buffer new branches; flush ONCE after the DB txn commits.
  const existingBranches = readBranches(branchesFile);
  const branchRegistry = new Set(existingBranches.map(b => String(b).toLowerCase()));
  const pendingBranches = [];

  const upsertCustomer = db.prepare(`
    INSERT INTO customers (loan_account_no, customer_number, customer_name, spouse_name, branch,
      center_name, group_name, mobile_number, residence_phone, aadhaar_number, voter_id, ration_card,
      gender, date_of_birth, officer_name, officer_code, product_name, loan_category, product_interest_rate,
      loan_amount, disbursement_date, first_installment_date, last_installment_date, last_payment_date,
      village, district, pincode, address, updated_at)
    VALUES (@loan_account_no, @customer_number, @customer_name, @spouse_name, @branch,
      @center_name, @group_name, @mobile_number, @residence_phone, @aadhaar_number, @voter_id, @ration_card,
      @gender, @date_of_birth, @officer_name, @officer_code, @product_name, @loan_category, @product_interest_rate,
      @loan_amount, @disbursement_date, @first_installment_date, @last_installment_date, @last_payment_date,
      @village, @district, @pincode, @address, @updated_at)
    ON CONFLICT(loan_account_no) DO UPDATE SET
      customer_number=excluded.customer_number, customer_name=excluded.customer_name, spouse_name=excluded.spouse_name, branch=excluded.branch,
      center_name=excluded.center_name, group_name=excluded.group_name, mobile_number=excluded.mobile_number,
      residence_phone=excluded.residence_phone, aadhaar_number=excluded.aadhaar_number, voter_id=excluded.voter_id, ration_card=excluded.ration_card,
      gender=excluded.gender, date_of_birth=excluded.date_of_birth, officer_name=excluded.officer_name, officer_code=excluded.officer_code,
      product_name=excluded.product_name, loan_category=excluded.loan_category, product_interest_rate=excluded.product_interest_rate,
      loan_amount=excluded.loan_amount, disbursement_date=excluded.disbursement_date, first_installment_date=excluded.first_installment_date,
      last_installment_date=excluded.last_installment_date, last_payment_date=excluded.last_payment_date,
      village=excluded.village, district=excluded.district, pincode=excluded.pincode, address=excluded.address,
      updated_at=excluded.updated_at
  `);

  // INSERT-ONLY semantics (idempotent): if a (snapshot_date, loan_account_no)
  // row already exists, leave it untouched. Re-uploading the same file is a
  // no-op for snapshots. To fix a bad row, delete it manually first, then
  // re-upload. (The customers table above still upserts so contact info /
  // branch changes propagate from re-uploads — that's intentional.)
  const insertSnap = db.prepare(`
    INSERT INTO pool_snapshots
      (snapshot_date, loan_account_no, branch, principal_outstanding, interest_outstanding, principal_overdue,
       interest_overdue, current_od, overdue_days, installments_paid, loan_status, account_dpd_classification,
       customer_dpd, customer_dpd_classification, last_payment_amount, total_interest_collected)
    VALUES
      (@snapshot_date, @loan_account_no, @branch, @principal_outstanding, @interest_outstanding, @principal_overdue,
       @interest_overdue, @current_od, @overdue_days, @installments_paid, @loan_status, @account_dpd_classification,
       @customer_dpd, @customer_dpd_classification, @last_payment_amount, @total_interest_collected)
    ON CONFLICT(snapshot_date, loan_account_no) DO NOTHING
  `);

  const now = new Date().toISOString();

  // Handle the one column in the file whose header has a leading space:
  // "| Last Payment Date".  Build a resolver that tolerates a few variants.
  const lastPaymentKey = (sample) => {
    const keys = Object.keys(sample || {});
    return keys.find(k => k.trim() === "Last Payment Date") || "Last Payment Date";
  };
  const lpKey = rows.length ? lastPaymentKey(rows[0]) : "Last Payment Date";

  const txn = db.transaction((rs) => {
    let total = 0, inserted = 0, skipped = 0;
    for (const r of rs) {
      const loan = str(r["Loan number"]);
      if (!loan) continue;
      const branch = str(r["Office Name"]);
      if (branch) {
        const key = branch.toLowerCase();
        if (!branchRegistry.has(key)) {
          branchRegistry.add(key);
          pendingBranches.push(branch);
        }
      }

      upsertCustomer.run({
        loan_account_no: loan,
        customer_number: str(r["Customer number"]),
        customer_name: str(r["Member Name"]),
        spouse_name: str(r["Spouse Name"]),
        branch,
        center_name: str(r["Center Name"]),
        group_name: str(r["Group Name"]),
        mobile_number: str(r["Mobile Number"]),
        residence_phone: str(r["Residence Phone Number"]),
        aadhaar_number: str(r["Aadhaar Number"]),
        voter_id: str(r["Voter ID Card"]),
        ration_card: str(r["Ration Card"]),
        gender: str(r["Gender"]),
        date_of_birth: str(r["Date of Birth"]),
        officer_name: str(r["Officer Name"]),
        officer_code: str(r["Officer Employee Number"]),
        product_name: remapProductName(r["Product Name"]),
        // "Category of Loan" from the Pool Report — values like "Group Loan" /
        // "Individual Loan". Drives the OD Insights Group vs Individual tab split.
        // Fallback: when the Pool export doesn't include this column (older
        // exports), derive from Center Name / Group Name presence so we never
        // store an empty value.
        loan_category: (() => {
          const explicit = str(r["Category of Loan"]);
          if (explicit) return explicit;
          const ctr = str(r["Center Name"]);
          const grp = str(r["Group Name"]);
          return (ctr || grp) ? "Group Loan" : "Individual Loan";
        })(),
        product_interest_rate: num(r["Product Interest Rate(%)"]),
        loan_amount: num(r["Loan Amount"]),
        disbursement_date: str(r["Disbursement Date"]),
        first_installment_date: str(r["First Installment Date"]),
        last_installment_date: str(r["Last Installment Date"]),
        last_payment_date: str(r[lpKey]),
        village: str(r["Village"]),
        district: str(r["District"]),
        pincode: str(r["Pincode"]),
        address: str(r["Residence Address Line-1(H no/Block)"]),
        updated_at: now,
      });

      const info = insertSnap.run({
        snapshot_date: snapshotDate,
        loan_account_no: loan,
        branch,
        principal_outstanding: num(r["Principal Outstanding"]),
        interest_outstanding: num(r["Interest Outstanding"]),
        principal_overdue: num(r["Principal Overdue"]),
        interest_overdue: num(r["Interest OverDue"]),
        current_od: num(r["Current OD"]),
        overdue_days: Math.round(num(r["Overdue Days"])),
        installments_paid: Math.round(num(r["Number of Installments(Paid)"])),
        loan_status: str(r["Loan Status"]),
        account_dpd_classification: str(r["Account DPD Classification"]),
        customer_dpd: Math.round(num(r["Customer DPD"])),
        customer_dpd_classification: str(r["Customer DPD Classification"]),
        last_payment_amount: num(r["Last Payment Amount"]),
        total_interest_collected: num(r["Total Interest Collected"]),
      });

      total++;
      if (info.changes > 0) inserted++; else skipped++;
    }
    return { total, inserted, skipped };
  });

  const { total: rowCount, inserted: rowsInserted, skipped: rowsSkipped } = txn(rows);

  // Flush branches AFTER the DB commit so the file and DB stay consistent
  // even if the transaction rolls back mid-way.
  let newBranches = 0;
  if (pendingBranches.length) {
    try {
      const updated = existingBranches.concat(pendingBranches);
      writeBranchesAtomic(branchesFile, updated);
      newBranches = pendingBranches.length;
    } catch (err) {
      // DB is already committed; log but don't fail the request.
      console.error("[ingest] failed to update branches.json:", err.message);
    }
  }

  db.prepare(
    `INSERT INTO upload_log (kind, filename, snapshot_date, row_count, new_branches, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run("pool", filename, snapshotDate, rowsInserted, newBranches, uploadedBy, now);

  checkpoint();
  return { rowCount, rowsInserted, rowsSkipped, newBranches };
}

// ── Foreclosure report ingestion ──────────────────────────────────────────
// File: ForeclosureReport_<DDMMYYYY_HHMMSS>.csv
// Format: pipe-delimited, 24 columns. Numeric IDs (BRANCH CODE, CUSTOMER NUMBER,
// ACCOUNT NUMBER, EMPLOYEE NUMBER) are wrapped in single quotes:
//   '30'|'9867551156'|'8800223323'  → strip the leading/trailing single quote.
//
// Why this also writes to the `customers` table:
//   The Group OD Entry autofill queries `customers` (via /api/customers/lookup).
//   Pool ingest already populates `customers`, so to make CLOSED-loan customers
//   discoverable in autofill without touching any frontend / autofill code,
//   we upsert closed accounts into the same `customers` table here. The
//   existing /api/customers/lookup endpoint then finds them automatically.
const FORECLOSURE_REQUIRED_COLS = [
  "BRANCH NAME",
  "CUSTOMER NUMBER",
  "ACCOUNT NUMBER",
  "CLOSED DATE",
];

// Strip wrapping single quotes (e.g. "'9867551156'") OR double quotes,
// then trim whitespace. Foreclosure-specific helper because pool's str()
// only handles double quotes.
const fcStr = (v) => {
  if (v == null) return "";
  let s = String(v).trim();
  if (s.length >= 2) {
    const a = s.charAt(0);
    const b = s.charAt(s.length - 1);
    if ((a === "'" && b === "'") || (a === '"' && b === '"')) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
};

const fcNum = (v) => {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/['"]/g, "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function ingestForeclosure(fileContent, opts) {
  const { snapshotDate, branchesFile, uploadedBy, filename } = opts;

  let rows;
  try {
    rows = parse(fileContent, {
      delimiter: "|",
      quote: '"',
      columns: true,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    const e = new Error(`Could not parse foreclosure report CSV: ${err.message}`);
    e.statusCode = 400;
    throw e;
  }

  if (rows.length === 0) {
    const e = new Error("Foreclosure report contains no data rows.");
    e.statusCode = 400;
    throw e;
  }

  const missing = missingColumns(rows[0], FORECLOSURE_REQUIRED_COLS);
  if (missing.length) {
    const e = new Error(
      `Foreclosure report is missing required columns: ${missing.join(", ")}. ` +
      `Got: ${Object.keys(rows[0]).join(", ")}`
    );
    e.statusCode = 400;
    throw e;
  }

  const existingBranches = readBranches(branchesFile);
  const branchRegistry = new Set(existingBranches.map(b => String(b).toLowerCase()));
  const pendingBranches = [];

  // Same upsert pattern as ingestPool — keeps `customers` as the single
  // source of truth for autofill across active + closed loans.
  // loan_category is set ONLY on INSERT (new row) using the heuristic; on
  // CONFLICT we deliberately don't touch it so an authoritative value already
  // written by ingestPool ("Category of Loan" column) isn't clobbered by our
  // fallback guess.
  const upsertCustomer = db.prepare(`
    INSERT INTO customers (loan_account_no, customer_number, customer_name, branch,
      center_name, product_name, loan_amount, disbursement_date, last_installment_date,
      officer_name, officer_code, loan_category, updated_at)
    VALUES (@loan_account_no, @customer_number, @customer_name, @branch,
      @center_name, @product_name, @loan_amount, @disbursement_date, @last_installment_date,
      @officer_name, @officer_code, @loan_category, @updated_at)
    ON CONFLICT(loan_account_no) DO UPDATE SET
      customer_number=excluded.customer_number,
      customer_name=excluded.customer_name,
      branch=excluded.branch,
      center_name=excluded.center_name,
      product_name=excluded.product_name,
      loan_amount=excluded.loan_amount,
      disbursement_date=excluded.disbursement_date,
      last_installment_date=excluded.last_installment_date,
      officer_name=excluded.officer_name,
      officer_code=excluded.officer_code,
      updated_at=excluded.updated_at
  `);

  const upsertSnap = db.prepare(`
    INSERT INTO foreclosure_snapshots
      (snapshot_date, loan_account_no, branch_name, branch_code, center,
       customer_number, customer_name, product_name, loan_amount, cycle_number,
       disbursement_date, maturity_date, closed_date, closure_reason, closure_type,
       interest_collected, total_interest_collected, closing_principal, penalty_collected,
       funder, funding_source, user_name, employee_name, employee_number, remarks)
    VALUES
      (@snapshot_date, @loan_account_no, @branch_name, @branch_code, @center,
       @customer_number, @customer_name, @product_name, @loan_amount, @cycle_number,
       @disbursement_date, @maturity_date, @closed_date, @closure_reason, @closure_type,
       @interest_collected, @total_interest_collected, @closing_principal, @penalty_collected,
       @funder, @funding_source, @user_name, @employee_name, @employee_number, @remarks)
    ON CONFLICT(snapshot_date, loan_account_no) DO UPDATE SET
      branch_name=excluded.branch_name, branch_code=excluded.branch_code, center=excluded.center,
      customer_number=excluded.customer_number, customer_name=excluded.customer_name,
      product_name=excluded.product_name, loan_amount=excluded.loan_amount, cycle_number=excluded.cycle_number,
      disbursement_date=excluded.disbursement_date, maturity_date=excluded.maturity_date,
      closed_date=excluded.closed_date, closure_reason=excluded.closure_reason, closure_type=excluded.closure_type,
      interest_collected=excluded.interest_collected, total_interest_collected=excluded.total_interest_collected,
      closing_principal=excluded.closing_principal, penalty_collected=excluded.penalty_collected,
      funder=excluded.funder, funding_source=excluded.funding_source, user_name=excluded.user_name,
      employee_name=excluded.employee_name, employee_number=excluded.employee_number, remarks=excluded.remarks
  `);

  const now = new Date().toISOString();

  const txn = db.transaction((rs) => {
    let count = 0;
    for (const r of rs) {
      const loan = fcStr(r["ACCOUNT NUMBER"]);
      if (!loan) continue;

      const branch = fcStr(r["BRANCH NAME"]);
      if (branch) {
        const key = branch.toLowerCase();
        if (!branchRegistry.has(key)) {
          branchRegistry.add(key);
          pendingBranches.push(branch);
        }
      }

      // Customer master upsert — keep this minimal and only overwrite fields
      // we actually have from the foreclosure CSV. The pool report fills the
      // richer fields (mobile, aadhaar, address, etc.) when the same loan was
      // ever active.
      const fcCenter = fcStr(r["CENTER"]);
      upsertCustomer.run({
        loan_account_no: loan,
        customer_number: fcStr(r["CUSTOMER NUMBER"]),
        customer_name: fcStr(r["CUSTOMER"]),
        branch,
        center_name: fcCenter,
        product_name: remapProductName(r["PRODUCT NAME"]),
        loan_amount: fcNum(r["LOAN AMOUNT"]),
        disbursement_date: fcStr(r["DISBURSEMENT DATE"]),
        last_installment_date: fcStr(r["MATURITY DATE"]),
        officer_name: fcStr(r["EMPLOYEE NAME"]),
        officer_code: fcStr(r["EMPLOYEE NUMBER"]),
        // Heuristic only used on INSERT (new row). Foreclosure CSV has no
        // explicit category column, so derive from CENTER presence.
        loan_category: fcCenter ? "Group Loan" : "Individual Loan",
        updated_at: now,
      });

      upsertSnap.run({
        snapshot_date: snapshotDate,
        loan_account_no: loan,
        branch_name: branch,
        branch_code: fcStr(r["BRANCH CODE"]),
        center: fcStr(r["CENTER"]),
        customer_number: fcStr(r["CUSTOMER NUMBER"]),
        customer_name: fcStr(r["CUSTOMER"]),
        product_name: remapProductName(r["PRODUCT NAME"]),
        loan_amount: fcNum(r["LOAN AMOUNT"]),
        cycle_number: Math.round(fcNum(r["CYCLE NUMBER"])),
        disbursement_date: fcStr(r["DISBURSEMENT DATE"]),
        maturity_date: fcStr(r["MATURITY DATE"]),
        closed_date: fcStr(r["CLOSED DATE"]),
        closure_reason: fcStr(r["CLOSURE REASON"]),
        closure_type: fcStr(r["CLOSURE TYPE"]),
        interest_collected: fcNum(r["INTEREST COLLECTED"]),
        total_interest_collected: fcNum(r["TOTAL_INTEREST_COLLECTED"]),
        closing_principal: fcNum(r["CLOSING PRINCIPAL"]),
        penalty_collected: fcNum(r["PENALTY COLLECTED"]),
        funder: fcStr(r["FUNDER"]),
        funding_source: fcStr(r["FUNDING SOURCE"]),
        user_name: fcStr(r["USER"]),
        employee_name: fcStr(r["EMPLOYEE NAME"]),
        employee_number: fcStr(r["EMPLOYEE NUMBER"]),
        remarks: fcStr(r["REMARKS"]),
      });

      count++;
    }
    return count;
  });

  const rowCount = txn(rows);

  let newBranches = 0;
  if (pendingBranches.length) {
    try {
      const updated = existingBranches.concat(pendingBranches);
      writeBranchesAtomic(branchesFile, updated);
      newBranches = pendingBranches.length;
    } catch (err) {
      console.error("[ingest] failed to update branches.json:", err.message);
    }
  }

  db.prepare(
    `INSERT INTO upload_log (kind, filename, snapshot_date, row_count, new_branches, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run("foreclosure", filename, snapshotDate, rowCount, newBranches, uploadedBy, now);

  checkpoint();
  return { rowCount, newBranches };
}

// ── Accrued report ingestion ───────────────────────────────────────────────
// Auto-detect delimiter — some exports are comma, some pipe-delimited.
function detectDelimiter(fileContent) {
  const firstLine = String(fileContent).split(/\r?\n/, 1)[0] || "";
  const pipes = (firstLine.match(/\|/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (pipes >= commas && pipes >= tabs && pipes > 0) return "|";
  if (tabs > commas && tabs > 0) return "\t";
  return ",";
}

function ingestAccrued(fileContent, opts) {
  const { snapshotDate, branchesFile, uploadedBy, filename } = opts;
  const delimiter = detectDelimiter(fileContent);

  let rows;
  try {
    rows = parse(fileContent, {
      delimiter,
      columns: (header) => header.map((h) => String(h).trim()),
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    const e = new Error(`Could not parse accrued interest CSV: ${err.message}`);
    e.statusCode = 400;
    throw e;
  }

  if (rows.length === 0) {
    return { rowCount: 0, rowsInserted: 0, rowsSkipped: 0, newBranches: 0, currentAccruedColumn: null };
  }

  const missing = missingColumns(rows[0], ACCRUED_REQUIRED_COLS);
  if (missing.length) {
    const e = new Error(
      `Accrued interest report is missing required columns: ${missing.join(", ")}. ` +
      `Got: ${Object.keys(rows[0]).join(", ")}`
    );
    e.statusCode = 400;
    throw e;
  }

  // The file has two "Accrued Interest (DD/MM/YYYY BOD)" columns — use the later one as "current".
  const keys = Object.keys(rows[0]);
  const accruedKeys = keys.filter(k => /Accrued\s*Interest/i.test(k));
  if (accruedKeys.length === 0) {
    const e = new Error(
      `Accrued interest report has no "Accrued Interest (DD/MM/YYYY BOD)" column.`
    );
    e.statusCode = 400;
    throw e;
  }
  const parseDate = (k) => {
    const m = k.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (!m) return 0;
    return new Date(`${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`).getTime();
  };
  accruedKeys.sort((a, b) => (parseDate(b) - parseDate(a)));
  const currentKey = accruedKeys[0];
  const prevKey = accruedKeys[1] || null;

  const existingBranches = readBranches(branchesFile);
  const branchRegistry = new Set(existingBranches.map(b => String(b).toLowerCase()));
  const pendingBranches = [];

  // INSERT-ONLY semantics (idempotent): see pool ingest comment above.
  const insertAccrued = db.prepare(`
    INSERT INTO accrued_snapshots
      (snapshot_date, loan_account_no, branch, principal_outstanding, accrued_interest, accrued_interest_prev,
       last_installment_date, last_paid_date)
    VALUES
      (@snapshot_date, @loan_account_no, @branch, @principal_outstanding, @accrued_interest, @accrued_interest_prev,
       @last_installment_date, @last_paid_date)
    ON CONFLICT(snapshot_date, loan_account_no) DO NOTHING
  `);

  const now = new Date().toISOString();

  const txn = db.transaction((rs) => {
    let total = 0, inserted = 0, skipped = 0;
    for (const r of rs) {
      const loan = str(r["Account Number"]);
      if (!loan) continue;
      const branch = str(r["Branch"]);
      if (branch) {
        const key = branch.toLowerCase();
        if (!branchRegistry.has(key)) {
          branchRegistry.add(key);
          pendingBranches.push(branch);
        }
      }

      const info = insertAccrued.run({
        snapshot_date: snapshotDate,
        loan_account_no: loan,
        branch,
        principal_outstanding: num(r["Principal Outstanding"]),
        accrued_interest: num(r[currentKey]),
        accrued_interest_prev: prevKey ? num(r[prevKey]) : 0,
        last_installment_date: str(r["Last Installment Date"]),
        last_paid_date: str(r["Last Paid Date"]),
      });
      total++;
      if (info.changes > 0) inserted++; else skipped++;
    }
    return { total, inserted, skipped };
  });

  const { total: rowCount, inserted: rowsInserted, skipped: rowsSkipped } = txn(rows);

  let newBranches = 0;
  if (pendingBranches.length) {
    try {
      const updated = existingBranches.concat(pendingBranches);
      writeBranchesAtomic(branchesFile, updated);
      newBranches = pendingBranches.length;
    } catch (err) {
      console.error("[ingest] failed to update branches.json:", err.message);
    }
  }

  db.prepare(
    `INSERT INTO upload_log (kind, filename, snapshot_date, row_count, new_branches, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run("accrued", filename, snapshotDate, rowsInserted, newBranches, uploadedBy, now);

  checkpoint();
  return { rowCount, rowsInserted, rowsSkipped, newBranches, currentAccruedColumn: currentKey };
}

// ── Date helpers ───────────────────────────────────────────────────────────
// Normalises the many date formats seen in the reports (1-Nov-1977, 30/01/2023,
// 01-04-2026, 2022-05-02, etc.) to ISO yyyy-mm-dd for consistent querying.
const MONTHS = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12" };
function toIsoDate(raw) {
  if (!raw) return "";
  const s = String(raw).trim().replace(/^"|"$/g, "");
  if (!s) return "";
  // yyyy-mm-dd or yyyy/mm/dd
  let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  // dd-Mon-yyyy
  m = s.match(/^(\d{1,2})[\-\/\s]([A-Za-z]{3,})[\-\/\s](\d{4})/);
  if (m) {
    const mon = MONTHS[m[2].slice(0,3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[1]).padStart(2,"0")}`;
  }
  // dd/mm/yyyy or dd-mm-yyyy
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  return "";
}

// ── Overdue report ingestion ───────────────────────────────────────────────
// Pipe-delimited. One row per delinquent account on the snapshot date.
function ingestOverdue(fileContent, opts) {
  const { snapshotDate, branchesFile, uploadedBy, filename } = opts;
  const delimiter = detectDelimiter(fileContent);
  const rows = parse(fileContent, {
    delimiter,
    columns: (header) => header.map((h) => String(h).trim().replace(/^"|"$/g, "")),
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
  if (rows.length === 0) return { rowCount: 0, rowsInserted: 0, rowsSkipped: 0, newBranches: 0 };

  const branches = (() => {
    try { return JSON.parse(fs.readFileSync(branchesFile, "utf8")); } catch { return []; }
  })();
  const branchRegistry = new Set(branches.map(b => b.toLowerCase()));
  let newBranches = 0;

  // INSERT-ONLY semantics (idempotent): re-uploading the same file is a no-op.
  // To fix a bad row, delete it manually first, then re-upload.
  const insert = db.prepare(`
    INSERT OR IGNORE INTO od_overdue (
      snapshot_date, loan_account_no, customer_number, customer_name, telephone, guarantor_name,
      branch_name, branch_code, officer_name, officer_code, center_name, center_code, group_name,
      date_of_birth, religious_group, caste, locale, state, product, loan_amount, loan_cycle,
      last_payment_approp_date, last_payment_approp_amount, repayment_frequency, maturity_date,
      interest_rate, emi, purpose_category, purpose, fund_source,
      principal_outstanding, interest_outstanding, fee_insurance_outstanding, disbursement_date,
      installments_due, earliest_unpaid_demand_date, latest_unpaid_demand_date,
      principal_default, interest_default, min_principal_overdue_days, max_principal_overdue_days,
      account_status, death_case_remark, death_flagged_date, moratorium_availed, is_restructured,
      dpd_classification, npa_date, first_npa_date, current_npa_date
    ) VALUES (
      @snapshot_date, @loan_account_no, @customer_number, @customer_name, @telephone, @guarantor_name,
      @branch_name, @branch_code, @officer_name, @officer_code, @center_name, @center_code, @group_name,
      @date_of_birth, @religious_group, @caste, @locale, @state, @product, @loan_amount, @loan_cycle,
      @last_payment_approp_date, @last_payment_approp_amount, @repayment_frequency, @maturity_date,
      @interest_rate, @emi, @purpose_category, @purpose, @fund_source,
      @principal_outstanding, @interest_outstanding, @fee_insurance_outstanding, @disbursement_date,
      @installments_due, @earliest_unpaid_demand_date, @latest_unpaid_demand_date,
      @principal_default, @interest_default, @min_principal_overdue_days, @max_principal_overdue_days,
      @account_status, @death_case_remark, @death_flagged_date, @moratorium_availed, @is_restructured,
      @dpd_classification, @npa_date, @first_npa_date, @current_npa_date
    )
  `);

  const now = new Date().toISOString();
  const txn = db.transaction((rs) => {
    let total = 0, inserted = 0, skipped = 0;
    for (const r of rs) {
      const loan = str(r["Account Number"]);
      if (!loan) continue;
      const branch = str(r["Branch Name"]);
      if (branch && !branchRegistry.has(branch.toLowerCase())) {
        addBranchIfMissing(branchesFile, branch, branchRegistry);
        newBranches++;
      }
      const info = insert.run({
        snapshot_date: snapshotDate,
        loan_account_no: loan,
        customer_number: str(r["Customer Number"]),
        customer_name: str(r["Customer"]),
        telephone: str(r["Telephone"]),
        guarantor_name: str(r["Guarantor's Name"]),
        branch_name: branch,
        branch_code: str(r["Branch Code"]),
        officer_name: str(r["Officer"]),
        officer_code: str(r["Officer Employee Number"]),
        center_name: str(r["Center"]),
        center_code: str(r["Center Code"]),
        group_name: str(r["Group"]),
        date_of_birth: toIsoDate(r["Date of Birth"]),
        religious_group: str(r["Religious Group"]),
        caste: str(r["Caste"]),
        locale: str(r["Locale"]),
        state: str(r["State"]),
        product: str(r["Product"]),
        loan_amount: num(r["Loan Amount"]),
        loan_cycle: Math.round(num(r["Loan Cycle"])),
        last_payment_approp_date: toIsoDate(r["Last Payment Appropriation Date"]),
        last_payment_approp_amount: num(r["Last Payment Appropriation Amount"]),
        repayment_frequency: str(r["Repayment Frequency"]),
        maturity_date: toIsoDate(r["Maturity Date"]),
        interest_rate: num(r["Interest Rate (%)"]),
        emi: num(r["EMI"]),
        purpose_category: str(r["Purpose Category"]),
        purpose: str(r["Purpose"]),
        fund_source: str(r["Fund Source"]),
        principal_outstanding: num(r["Principal Outstanding"]),
        interest_outstanding: num(r["Interest Outstanding"]),
        fee_insurance_outstanding: num(r["Fee & Insurance Outstanding"]),
        disbursement_date: toIsoDate(r["Disbursement Date"]),
        installments_due: Math.round(num(r["# Installments Due"])),
        earliest_unpaid_demand_date: toIsoDate(r["Earliest Unpaid Demand Date"]),
        latest_unpaid_demand_date: toIsoDate(r["Latest Unpaid Demand Date"]),
        principal_default: num(r["Principal Default"]),
        interest_default: num(r["Interest Default"]),
        min_principal_overdue_days: Math.round(num(r["Minimum Principal Overdue Days"])),
        max_principal_overdue_days: Math.round(num(r["Maximum Principal Overdue Days"])),
        account_status: str(r["Account Status"]),
        death_case_remark: str(r["Death Case Remark"]),
        death_flagged_date: toIsoDate(r["Death Flagged Date"]),
        moratorium_availed: str(r["Moratorium Availed"]),
        is_restructured: str(r["Is Restructured"]),
        dpd_classification: str(r["DPD Classification"]),
        npa_date: toIsoDate(r["NPA Date"]),
        first_npa_date: toIsoDate(r["First NPA Date"]),
        current_npa_date: toIsoDate(r["Current NPA Date"]),
      });
      total++;
      if (info.changes > 0) inserted++; else skipped++;
    }
    return { total, inserted, skipped };
  });

  const { total: rowCount, inserted: rowsInserted, skipped: rowsSkipped } = txn(rows);
  db.prepare(
    `INSERT INTO upload_log (kind, filename, snapshot_date, row_count, new_branches, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run("overdue", filename, snapshotDate, rowsInserted, newBranches, uploadedBy, now);
  return { rowCount, rowsInserted, rowsSkipped, newBranches };
}

// ── Collection report (transactional ledger) ───────────────────────────────
// Pipe-delimited. One row per receipt. Idempotent on receipt_no so re-uploading
// the same extract is safe; duplicates are skipped and reported back.
function ingestCollections(fileContent, opts) {
  const { branchesFile, uploadedBy, filename } = opts;
  const delimiter = detectDelimiter(fileContent);
  const rows = parse(fileContent, {
    delimiter,
    columns: (header) => header.map((h) => String(h).trim().replace(/^"|"$/g, "")),
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
  if (rows.length === 0) {
    return { rowCount: 0, rowsInserted: 0, rowsSkipped: 0, newBranches: 0 };
  }

  const branches = (() => {
    try { return JSON.parse(fs.readFileSync(branchesFile, "utf8")); } catch { return []; }
  })();
  const branchRegistry = new Set(branches.map(b => b.toLowerCase()));
  let newBranches = 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO od_collections (
      receipt_no, loan_account_no, customer_number, customer_name,
      branch_name, branch_code, center_name, center_code, meeting_time,
      officer_name, officer_code, payment_officer_name, payment_officer_code, username,
      amount, paid_by, payment_date, payment_status, disbursement_date, mode,
      app_local_posting_time, posting_time, product, payment_app, narration,
      upi_txn_number, upi_rrn, uploaded_at
    ) VALUES (
      @receipt_no, @loan_account_no, @customer_number, @customer_name,
      @branch_name, @branch_code, @center_name, @center_code, @meeting_time,
      @officer_name, @officer_code, @payment_officer_name, @payment_officer_code, @username,
      @amount, @paid_by, @payment_date, @payment_status, @disbursement_date, @mode,
      @app_local_posting_time, @posting_time, @product, @payment_app, @narration,
      @upi_txn_number, @upi_rrn, @uploaded_at
    )
  `);

  const now = new Date().toISOString();
  const txn = db.transaction((rs) => {
    let inserted = 0, skipped = 0, total = 0;
    for (const r of rs) {
      total++;
      const receipt = str(r["Receipt No"]);
      if (!receipt) { skipped++; continue; }
      const branch = str(r["Branch Name"]);
      if (branch && !branchRegistry.has(branch.toLowerCase())) {
        addBranchIfMissing(branchesFile, branch, branchRegistry);
        newBranches++;
      }
      const info = insert.run({
        receipt_no: receipt,
        loan_account_no: str(r["Account No"]),
        customer_number: str(r["Customer Number"]),
        customer_name: str(r["Customer Name"]),
        branch_name: branch,
        branch_code: str(r["Branch Code"]),
        center_name: str(r["Center"]),
        center_code: str(r["Center Code"]),
        meeting_time: str(r["Meeting Time"]),
        officer_name: str(r["Officer Name"]),
        officer_code: str(r["Officer Code"]),
        payment_officer_name: str(r["Payment Officer Name"]),
        payment_officer_code: str(r["Payment Officer Code"]),
        username: str(r["Username"]),
        amount: num(r["Amount"]),
        paid_by: str(r["Paid By"]),
        payment_date: toIsoDate(r["Payment Date"]),
        payment_status: str(r["Payment Status"]),
        disbursement_date: toIsoDate(r["Disbursement Date"]),
        mode: str(r["Mode"]),
        app_local_posting_time: str(r["APP Local Posting Time"]),
        posting_time: str(r["Posting Time"]),
        product: str(r["Product"]),
        payment_app: str(r["Payment App"]),
        narration: str(r["Narration"]),
        upi_txn_number: str(r["UPI Transaction Number"]),
        upi_rrn: str(r["UPI RRN"]),
        uploaded_at: now,
      });
      if (info.changes > 0) inserted++; else skipped++;
    }
    return { inserted, skipped, total };
  });

  const { inserted, skipped, total } = txn(rows);
  db.prepare(
    `INSERT INTO upload_log (kind, filename, snapshot_date, row_count, new_branches, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run("collections", filename, null, inserted, newBranches, uploadedBy, now);
  return { rowCount: total, rowsInserted: inserted, rowsSkipped: skipped, newBranches };
}

// ── Client-wise Collection Report (per-account demand vs collected) ────────
// Pipe-delimited. One row per account for a period. Period boundaries come
// from the caller (detected from the file name or supplied by the user). Three
// Principal Outstanding snapshot columns are captured as start/mid/end.
function ingestClientPeriod(fileContent, opts) {
  const { periodStart, periodEnd, branchesFile, uploadedBy, filename } = opts;
  const delimiter = detectDelimiter(fileContent);
  const rows = parse(fileContent, {
    delimiter,
    columns: (header) => header.map((h) => String(h).trim().replace(/^"|"$/g, "")),
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
  if (rows.length === 0) return { rowCount: 0, rowsInserted: 0, rowsSkipped: 0, newBranches: 0 };

  // Discover the 3 "Principal Outstanding (dd-mm-yyyy)" snapshot columns, then
  // sort by embedded date so we can assign start/mid/end consistently.
  const keys = Object.keys(rows[0]);
  const principalCols = keys.filter(k => /^PRINCIPAL\s+OUTSTANDING\s*\(/i.test(k));
  const parseHeaderDate = (k) => {
    const m = k.match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})/);
    if (!m) return 0;
    return new Date(`${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`).getTime();
  };
  principalCols.sort((a, b) => parseHeaderDate(a) - parseHeaderDate(b));
  const poStartKey = principalCols[0] || null;
  const poEndKey = principalCols[principalCols.length - 1] || null;
  const poMidKey = principalCols.length > 2 ? principalCols[1] : (principalCols.length === 2 ? principalCols[0] : null);

  const branches = (() => {
    try { return JSON.parse(fs.readFileSync(branchesFile, "utf8")); } catch { return []; }
  })();
  const branchRegistry = new Set(branches.map(b => b.toLowerCase()));
  let newBranches = 0;

  // INSERT-ONLY semantics (idempotent): re-uploading the same period is a no-op.
  // To fix a bad row, delete it manually first, then re-upload.
  const insert = db.prepare(`
    INSERT OR IGNORE INTO od_client_period (
      period_start, period_end, loan_account_no, customer_number, customer_name,
      branch_name, branch_code, center_name, center_code, officer_name, officer_code,
      product_name, account_status, disbursement_date, closing_date, installments_remaining,
      principal_outstanding_start, principal_outstanding_mid, principal_outstanding_end,
      interest_outstanding, principal_demand, principal_prepayment, interest_prepayment,
      last_principal_demand_date, principal_collected, last_principal_collected_date,
      interest_demand, last_interest_demand_date, interest_collected, differential_interest,
      last_interest_collected_date, other_charges, moratorium_interest_collection, total_collection,
      advance_amount, principal_overdue, interest_overdue, funder_name, fund_source_name
    ) VALUES (
      @period_start, @period_end, @loan_account_no, @customer_number, @customer_name,
      @branch_name, @branch_code, @center_name, @center_code, @officer_name, @officer_code,
      @product_name, @account_status, @disbursement_date, @closing_date, @installments_remaining,
      @principal_outstanding_start, @principal_outstanding_mid, @principal_outstanding_end,
      @interest_outstanding, @principal_demand, @principal_prepayment, @interest_prepayment,
      @last_principal_demand_date, @principal_collected, @last_principal_collected_date,
      @interest_demand, @last_interest_demand_date, @interest_collected, @differential_interest,
      @last_interest_collected_date, @other_charges, @moratorium_interest_collection, @total_collection,
      @advance_amount, @principal_overdue, @interest_overdue, @funder_name, @fund_source_name
    )
  `);

  const now = new Date().toISOString();
  const txn = db.transaction((rs) => {
    let total = 0, inserted = 0, skipped = 0;
    for (const r of rs) {
      const loan = str(r["ACCOUNT NUMBER"]);
      if (!loan) continue;
      const branch = str(r["BRANCH NAME"]);
      if (branch && !branchRegistry.has(branch.toLowerCase())) {
        addBranchIfMissing(branchesFile, branch, branchRegistry);
        newBranches++;
      }
      const info = insert.run({
        period_start: periodStart,
        period_end: periodEnd,
        loan_account_no: loan,
        customer_number: str(r["CUSTOMER NUMBER"]),
        customer_name: str(r["NAME"]),
        branch_name: branch,
        branch_code: str(r["BRANCH CODE"]),
        center_name: str(r["CENTER"]),
        center_code: str(r["CENTER CODE"]),
        officer_name: str(r["RELATIONSHIP OFFICER"]),
        officer_code: str(r["EMPLOYEE NUMBER"]),
        product_name: remapProductName(r["PRODUCT NAME"]),
        account_status: str(r["ACCOUNT STATUS"]),
        disbursement_date: toIsoDate(r["DISB DATE"]),
        closing_date: toIsoDate(r["CLOSING DATE"]),
        installments_remaining: Math.round(num(r["INSTALLMENTS REMAINING"])),
        principal_outstanding_start: poStartKey ? num(r[poStartKey]) : 0,
        principal_outstanding_mid: poMidKey ? num(r[poMidKey]) : 0,
        principal_outstanding_end: poEndKey ? num(r[poEndKey]) : 0,
        interest_outstanding: num(r["INTEREST OUTSTANDING"]),
        principal_demand: num(r["PRINCIPAL DEMAND"]),
        principal_prepayment: num(r["PRINCIPAL PREPAYMENT"]),
        interest_prepayment: num(r["INTEREST PREPAYMENT"]),
        last_principal_demand_date: toIsoDate(r["LAST PRINCIPAL DEMAND DATE"]),
        principal_collected: num(r["PRINCIPAL COLLECTED"]),
        last_principal_collected_date: toIsoDate(r["LAST PRINCIPAL COLLECTED DATE"]),
        interest_demand: num(r["INTEREST DEMAND"]),
        last_interest_demand_date: toIsoDate(r["LAST INTEREST DEMAND DATE"]),
        interest_collected: num(r["INTEREST COLLECTED"]),
        differential_interest: num(r["DIFFERENTIAL INTEREST"]),
        last_interest_collected_date: toIsoDate(r["LAST INTEREST COLLECTED DATE"]),
        other_charges: num(r["OTHER CHARGES"]),
        moratorium_interest_collection: num(r["MORATORIUM INTEREST COLLECTION"]),
        total_collection: num(r["TOTAL COLLECTION"]),
        advance_amount: num(r["ADVANCE AMOUNT (As of to-date)"]),
        principal_overdue: num(r["PRINCIPAL OVERDUE"]),
        interest_overdue: num(r["INTEREST OVERDUE"]),
        funder_name: str(r["FUNDER NAME"]),
        fund_source_name: str(r["FUND SOURCE NAME"]),
      });
      total++;
      if (info.changes > 0) inserted++; else skipped++;
    }
    return { total, inserted, skipped };
  });

  const { total: rowCount, inserted: rowsInserted, skipped: rowsSkipped } = txn(rows);
  db.prepare(
    `INSERT INTO upload_log (kind, filename, snapshot_date, row_count, new_branches, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run("client_period", filename, periodEnd, rowsInserted, newBranches, uploadedBy, now);
  return { rowCount, rowsInserted, rowsSkipped, newBranches, principalCols: principalCols.length };
}

// ── Monthly rollup (NEVER purged) ──────────────────────────────────────────
// Before the 90-day purge, take the latest snapshot of each calendar month and
// upsert it into the long-horizon *_monthly_* tables. This preserves month-end
// insights forever while keeping the daily hot tables lean.
//
// Idempotent — rerunning for the same month just overwrites the same PK.
// Uses the same DPD bucket definition as /api/od/metrics/dpd.
function rollupMonthlySnapshots(opts = {}) {
  const trigger = opts.trigger || "manual";
  const startedAt = Date.now();

  // For each (year_month) in the source table, find the MAX(snapshot_date).
  // We roll up EVERY month currently present — cheap, and self-heals gaps.
  const poolMonthMax = db.prepare(
    `SELECT substr(snapshot_date,1,7) AS ym, MAX(snapshot_date) AS max_date
       FROM pool_snapshots GROUP BY substr(snapshot_date,1,7)`
  ).all();
  const overdueMonthMax = db.prepare(
    `SELECT substr(snapshot_date,1,7) AS ym, MAX(snapshot_date) AS max_date
       FROM od_overdue GROUP BY substr(snapshot_date,1,7)`
  ).all();
  const accruedMonthMax = db.prepare(
    `SELECT substr(snapshot_date,1,7) AS ym, MAX(snapshot_date) AS max_date
       FROM accrued_snapshots GROUP BY substr(snapshot_date,1,7)`
  ).all();

  const dpdBucketSql = `
    CASE
      WHEN COALESCE(overdue_days,0) <= 0 THEN '0-Current'
      WHEN overdue_days BETWEEN 1 AND 30 THEN '1-30'
      WHEN overdue_days BETWEEN 31 AND 60 THEN '31-60'
      WHEN overdue_days BETWEEN 61 AND 90 THEN '61-90'
      WHEN overdue_days BETWEEN 91 AND 180 THEN '91-180'
      ELSE '180+'
    END`;
  const overdueDpdBucketSql = `
    CASE
      WHEN COALESCE(max_principal_overdue_days,0) <= 0 THEN '0-Current'
      WHEN max_principal_overdue_days BETWEEN 1 AND 30 THEN '1-30'
      WHEN max_principal_overdue_days BETWEEN 31 AND 60 THEN '31-60'
      WHEN max_principal_overdue_days BETWEEN 61 AND 90 THEN '61-90'
      WHEN max_principal_overdue_days BETWEEN 91 AND 180 THEN '91-180'
      ELSE '180+'
    END`;

  const upsertPoolAccount = db.prepare(`
    INSERT INTO pool_monthly_account (
      year_month, loan_account_no, snapshot_date, branch,
      principal_outstanding, interest_outstanding, principal_overdue, interest_overdue,
      current_od, overdue_days, installments_paid, loan_status,
      account_dpd_classification, customer_dpd, customer_dpd_classification,
      last_payment_amount, total_interest_collected
    )
    SELECT ?, loan_account_no, snapshot_date, branch,
      principal_outstanding, interest_outstanding, principal_overdue, interest_overdue,
      current_od, overdue_days, installments_paid, loan_status,
      account_dpd_classification, customer_dpd, customer_dpd_classification,
      last_payment_amount, total_interest_collected
    FROM pool_snapshots WHERE snapshot_date = ?
    ON CONFLICT(year_month, loan_account_no) DO UPDATE SET
      snapshot_date = excluded.snapshot_date,
      branch = excluded.branch,
      principal_outstanding = excluded.principal_outstanding,
      interest_outstanding = excluded.interest_outstanding,
      principal_overdue = excluded.principal_overdue,
      interest_overdue = excluded.interest_overdue,
      current_od = excluded.current_od,
      overdue_days = excluded.overdue_days,
      installments_paid = excluded.installments_paid,
      loan_status = excluded.loan_status,
      account_dpd_classification = excluded.account_dpd_classification,
      customer_dpd = excluded.customer_dpd,
      customer_dpd_classification = excluded.customer_dpd_classification,
      last_payment_amount = excluded.last_payment_amount,
      total_interest_collected = excluded.total_interest_collected
  `);

  const upsertPoolAgg = db.prepare(`
    INSERT INTO pool_monthly_agg (
      year_month, branch, dpd_bucket, account_count,
      principal_outstanding, interest_outstanding,
      principal_overdue, interest_overdue, current_od
    )
    SELECT ?, COALESCE(branch,''), ${dpdBucketSql} AS dpd_bucket,
      COUNT(*),
      SUM(COALESCE(principal_outstanding,0)),
      SUM(COALESCE(interest_outstanding,0)),
      SUM(COALESCE(principal_overdue,0)),
      SUM(COALESCE(interest_overdue,0)),
      SUM(COALESCE(current_od,0))
    FROM pool_snapshots
    WHERE snapshot_date = ?
    GROUP BY COALESCE(branch,''), dpd_bucket
    ON CONFLICT(year_month, branch, dpd_bucket) DO UPDATE SET
      account_count = excluded.account_count,
      principal_outstanding = excluded.principal_outstanding,
      interest_outstanding = excluded.interest_outstanding,
      principal_overdue = excluded.principal_overdue,
      interest_overdue = excluded.interest_overdue,
      current_od = excluded.current_od
  `);

  const upsertOverdueAccount = db.prepare(`
    INSERT INTO overdue_monthly_account (
      year_month, loan_account_no, snapshot_date, customer_number, customer_name,
      branch_name, branch_code, officer_code,
      principal_outstanding, interest_outstanding, installments_due,
      principal_default, interest_default,
      min_principal_overdue_days, max_principal_overdue_days,
      dpd_classification, first_npa_date, current_npa_date,
      account_status, death_case_remark
    )
    SELECT ?, loan_account_no, snapshot_date, customer_number, customer_name,
      branch_name, branch_code, officer_code,
      principal_outstanding, interest_outstanding, installments_due,
      principal_default, interest_default,
      min_principal_overdue_days, max_principal_overdue_days,
      dpd_classification, first_npa_date, current_npa_date,
      account_status, death_case_remark
    FROM od_overdue WHERE snapshot_date = ?
    ON CONFLICT(year_month, loan_account_no) DO UPDATE SET
      snapshot_date = excluded.snapshot_date,
      customer_number = excluded.customer_number,
      customer_name = excluded.customer_name,
      branch_name = excluded.branch_name,
      branch_code = excluded.branch_code,
      officer_code = excluded.officer_code,
      principal_outstanding = excluded.principal_outstanding,
      interest_outstanding = excluded.interest_outstanding,
      installments_due = excluded.installments_due,
      principal_default = excluded.principal_default,
      interest_default = excluded.interest_default,
      min_principal_overdue_days = excluded.min_principal_overdue_days,
      max_principal_overdue_days = excluded.max_principal_overdue_days,
      dpd_classification = excluded.dpd_classification,
      first_npa_date = excluded.first_npa_date,
      current_npa_date = excluded.current_npa_date,
      account_status = excluded.account_status,
      death_case_remark = excluded.death_case_remark
  `);

  const upsertOverdueAgg = db.prepare(`
    INSERT INTO overdue_monthly_agg (
      year_month, branch_name, dpd_bucket, account_count,
      principal_default, interest_default,
      principal_outstanding, interest_outstanding
    )
    SELECT ?, COALESCE(branch_name,''), ${overdueDpdBucketSql} AS dpd_bucket,
      COUNT(*),
      SUM(COALESCE(principal_default,0)),
      SUM(COALESCE(interest_default,0)),
      SUM(COALESCE(principal_outstanding,0)),
      SUM(COALESCE(interest_outstanding,0))
    FROM od_overdue
    WHERE snapshot_date = ?
    GROUP BY COALESCE(branch_name,''), dpd_bucket
    ON CONFLICT(year_month, branch_name, dpd_bucket) DO UPDATE SET
      account_count = excluded.account_count,
      principal_default = excluded.principal_default,
      interest_default = excluded.interest_default,
      principal_outstanding = excluded.principal_outstanding,
      interest_outstanding = excluded.interest_outstanding
  `);

  const upsertAccruedAccount = db.prepare(`
    INSERT INTO accrued_monthly_account (
      year_month, loan_account_no, snapshot_date, branch,
      principal_outstanding, accrued_interest, accrued_interest_prev,
      last_installment_date, last_paid_date
    )
    SELECT ?, loan_account_no, snapshot_date, branch,
      principal_outstanding, accrued_interest, accrued_interest_prev,
      last_installment_date, last_paid_date
    FROM accrued_snapshots WHERE snapshot_date = ?
    ON CONFLICT(year_month, loan_account_no) DO UPDATE SET
      snapshot_date = excluded.snapshot_date,
      branch = excluded.branch,
      principal_outstanding = excluded.principal_outstanding,
      accrued_interest = excluded.accrued_interest,
      accrued_interest_prev = excluded.accrued_interest_prev,
      last_installment_date = excluded.last_installment_date,
      last_paid_date = excluded.last_paid_date
  `);

  let poolAcctRows = 0, poolAggRows = 0;
  let overdueAcctRows = 0, overdueAggRows = 0;
  let accruedAcctRows = 0;
  const monthsTouched = new Set();

  const txn = db.transaction(() => {
    for (const { ym, max_date } of poolMonthMax) {
      if (!ym || !max_date) continue;
      poolAcctRows += upsertPoolAccount.run(ym, max_date).changes;
      poolAggRows  += upsertPoolAgg.run(ym, max_date).changes;
      monthsTouched.add(ym);
    }
    for (const { ym, max_date } of overdueMonthMax) {
      if (!ym || !max_date) continue;
      overdueAcctRows += upsertOverdueAccount.run(ym, max_date).changes;
      overdueAggRows  += upsertOverdueAgg.run(ym, max_date).changes;
      monthsTouched.add(ym);
    }
    for (const { ym, max_date } of accruedMonthMax) {
      if (!ym || !max_date) continue;
      accruedAcctRows += upsertAccruedAccount.run(ym, max_date).changes;
      monthsTouched.add(ym);
    }
  });
  txn();

  const durationMs = Date.now() - startedAt;
  const months = Array.from(monthsTouched).sort();
  db.prepare(
    `INSERT INTO rollup_log (
       run_at, pool_account_rows, pool_agg_rows,
       overdue_account_rows, overdue_agg_rows, accrued_account_rows,
       months_covered, duration_ms, trigger
     ) VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    new Date().toISOString(),
    poolAcctRows, poolAggRows,
    overdueAcctRows, overdueAggRows, accruedAcctRows,
    months.join(","), durationMs, trigger
  );

  return {
    poolAcctRows, poolAggRows,
    overdueAcctRows, overdueAggRows, accruedAcctRows,
    months, durationMs, trigger,
  };
}

// ── Retention ──────────────────────────────────────────────────────────────
function purgeOldSnapshots(retentionDays = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const iso = cutoff.toISOString().slice(0, 10);
  const r1 = db.prepare("DELETE FROM pool_snapshots WHERE snapshot_date < ?").run(iso);
  const r2 = db.prepare("DELETE FROM accrued_snapshots WHERE snapshot_date < ?").run(iso);
  const r3 = db.prepare("DELETE FROM upload_log WHERE uploaded_at < ?").run(cutoff.toISOString());
  const r4 = db.prepare("DELETE FROM od_overdue WHERE snapshot_date < ?").run(iso);
  // foreclosure_snapshots: per-snapshot closure details. Customer master record
  // in `customers` is NOT purged here, so closed-loan customers stay searchable
  // in autofill; we only drop the historical close-out financial details.
  const r5 = db.prepare("DELETE FROM foreclosure_snapshots WHERE snapshot_date < ?").run(iso);
  // od_collections is an immutable ledger — keep indefinitely unless admin purges.
  // od_client_period kept — typically small, one row per account per period.
  // *_monthly_* rollup tables are NEVER purged — they hold the long-horizon view.
  // Reclaim space after a purge. VACUUM cannot run inside a transaction and
  // briefly exclusive-locks the DB, so schedule it on a retention run only.
  try { db.exec("VACUUM"); }
  catch (err) { console.warn("[purge] VACUUM failed:", err.message); }
  return { poolDeleted: r1.changes, accruedDeleted: r2.changes, logDeleted: r3.changes, overdueDeleted: r4.changes, foreclosureDeleted: r5.changes, cutoff: iso };
}

module.exports = {
  ingestPool, ingestAccrued, ingestOverdue, ingestCollections, ingestClientPeriod,
  ingestForeclosure,
  purgeOldSnapshots, rollupMonthlySnapshots,
  toIsoDate, detectDelimiter,
};
