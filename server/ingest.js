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

// ── helpers ────────────────────────────────────────────────────────────────
const num = (v) => {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/["]/g, "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const str = (v) => {
  if (v == null) return "";
  return String(v).replace(/^"|"$/g, "").trim();
};

// Auto-add branches we've never seen. Updates branches.json in-place.
function addBranchIfMissing(branchesFile, branch, registry) {
  if (!branch) return false;
  const key = branch.toLowerCase();
  if (registry.has(key)) return false;
  let branches = [];
  try { branches = JSON.parse(fs.readFileSync(branchesFile, "utf8")); } catch { branches = []; }
  if (!branches.some(b => b.toLowerCase() === key)) {
    branches.push(branch);
    fs.writeFileSync(branchesFile, JSON.stringify(branches, null, 2), "utf8");
  }
  registry.add(key);
  return true;
}

// ── Pool report ingestion ──────────────────────────────────────────────────
function ingestPool(fileContent, opts) {
  const { snapshotDate, branchesFile, uploadedBy, filename } = opts;

  const rows = parse(fileContent, {
    delimiter: "|",
    quote: '"',
    columns: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  const branches = (() => {
    try { return JSON.parse(fs.readFileSync(branchesFile, "utf8")); } catch { return []; }
  })();
  const branchRegistry = new Set(branches.map(b => b.toLowerCase()));
  let newBranches = 0;

  const upsertCustomer = db.prepare(`
    INSERT INTO customers (loan_account_no, customer_number, customer_name, spouse_name, branch,
      center_name, group_name, mobile_number, residence_phone, aadhaar_number, voter_id, ration_card,
      gender, date_of_birth, officer_name, officer_code, product_name, product_interest_rate,
      loan_amount, disbursement_date, first_installment_date, last_installment_date, last_payment_date,
      village, district, pincode, address, updated_at)
    VALUES (@loan_account_no, @customer_number, @customer_name, @spouse_name, @branch,
      @center_name, @group_name, @mobile_number, @residence_phone, @aadhaar_number, @voter_id, @ration_card,
      @gender, @date_of_birth, @officer_name, @officer_code, @product_name, @product_interest_rate,
      @loan_amount, @disbursement_date, @first_installment_date, @last_installment_date, @last_payment_date,
      @village, @district, @pincode, @address, @updated_at)
    ON CONFLICT(loan_account_no) DO UPDATE SET
      customer_number=excluded.customer_number, customer_name=excluded.customer_name, spouse_name=excluded.spouse_name, branch=excluded.branch,
      center_name=excluded.center_name, group_name=excluded.group_name, mobile_number=excluded.mobile_number,
      residence_phone=excluded.residence_phone, aadhaar_number=excluded.aadhaar_number, voter_id=excluded.voter_id, ration_card=excluded.ration_card,
      gender=excluded.gender, date_of_birth=excluded.date_of_birth, officer_name=excluded.officer_name, officer_code=excluded.officer_code,
      product_name=excluded.product_name, product_interest_rate=excluded.product_interest_rate,
      loan_amount=excluded.loan_amount, disbursement_date=excluded.disbursement_date, first_installment_date=excluded.first_installment_date,
      last_installment_date=excluded.last_installment_date, last_payment_date=excluded.last_payment_date,
      village=excluded.village, district=excluded.district, pincode=excluded.pincode, address=excluded.address,
      updated_at=excluded.updated_at
  `);

  const upsertSnap = db.prepare(`
    INSERT OR REPLACE INTO pool_snapshots
      (snapshot_date, loan_account_no, branch, principal_outstanding, interest_outstanding, principal_overdue,
       interest_overdue, current_od, overdue_days, installments_paid, loan_status, account_dpd_classification,
       customer_dpd, customer_dpd_classification, last_payment_amount, total_interest_collected)
    VALUES
      (@snapshot_date, @loan_account_no, @branch, @principal_outstanding, @interest_outstanding, @principal_overdue,
       @interest_overdue, @current_od, @overdue_days, @installments_paid, @loan_status, @account_dpd_classification,
       @customer_dpd, @customer_dpd_classification, @last_payment_amount, @total_interest_collected)
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
    let count = 0;
    for (const r of rs) {
      const loan = str(r["Loan number"]);
      if (!loan) continue;
      const branch = str(r["Office Name"]);
      if (branch && !branchRegistry.has(branch.toLowerCase())) {
        addBranchIfMissing(branchesFile, branch, branchRegistry);
        newBranches++;
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
        product_name: str(r["Product Name"]),
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

      upsertSnap.run({
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

      count++;
    }
    return count;
  });

  const rowCount = txn(rows);

  db.prepare(
    `INSERT INTO upload_log (kind, filename, snapshot_date, row_count, new_branches, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run("pool", filename, snapshotDate, rowCount, newBranches, uploadedBy, now);

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
  const rows = parse(fileContent, {
    delimiter,
    columns: (header) => header.map((h) => String(h).trim()),
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  if (rows.length === 0) {
    return { rowCount: 0, newBranches: 0, currentAccruedColumn: null };
  }

  // The file has two "Accrued Interest (DD/MM/YYYY BOD)" columns — use the later one as "current".
  const keys = Object.keys(rows[0]);
  const accruedKeys = keys.filter(k => /Accrued\s*Interest/i.test(k));
  const parseDate = (k) => {
    const m = k.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (!m) return 0;
    return new Date(`${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`).getTime();
  };
  accruedKeys.sort((a, b) => (parseDate(b) - parseDate(a)));
  const currentKey = accruedKeys[0];
  const prevKey = accruedKeys[1] || null;

  const branches = (() => {
    try { return JSON.parse(fs.readFileSync(branchesFile, "utf8")); } catch { return []; }
  })();
  const branchRegistry = new Set(branches.map(b => b.toLowerCase()));
  let newBranches = 0;

  const upsertAccrued = db.prepare(`
    INSERT OR REPLACE INTO accrued_snapshots
      (snapshot_date, loan_account_no, branch, principal_outstanding, accrued_interest, accrued_interest_prev,
       last_installment_date, last_paid_date)
    VALUES
      (@snapshot_date, @loan_account_no, @branch, @principal_outstanding, @accrued_interest, @accrued_interest_prev,
       @last_installment_date, @last_paid_date)
  `);

  const now = new Date().toISOString();

  const txn = db.transaction((rs) => {
    let count = 0;
    for (const r of rs) {
      const loan = str(r["Account Number"]);
      if (!loan) continue;
      const branch = str(r["Branch"]);
      if (branch && !branchRegistry.has(branch.toLowerCase())) {
        addBranchIfMissing(branchesFile, branch, branchRegistry);
        newBranches++;
      }

      upsertAccrued.run({
        snapshot_date: snapshotDate,
        loan_account_no: loan,
        branch,
        principal_outstanding: num(r["Principal Outstanding"]),
        accrued_interest: num(r[currentKey]),
        accrued_interest_prev: prevKey ? num(r[prevKey]) : 0,
        last_installment_date: str(r["Last Installment Date"]),
        last_paid_date: str(r["Last Paid Date"]),
      });
      count++;
    }
    return count;
  });

  const rowCount = txn(rows);

  db.prepare(
    `INSERT INTO upload_log (kind, filename, snapshot_date, row_count, new_branches, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run("accrued", filename, snapshotDate, rowCount, newBranches, uploadedBy, now);

  return { rowCount, newBranches, currentAccruedColumn: currentKey };
}

// ── Retention ──────────────────────────────────────────────────────────────
function purgeOldSnapshots(retentionDays = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const iso = cutoff.toISOString().slice(0, 10);
  const r1 = db.prepare("DELETE FROM pool_snapshots WHERE snapshot_date < ?").run(iso);
  const r2 = db.prepare("DELETE FROM accrued_snapshots WHERE snapshot_date < ?").run(iso);
  const r3 = db.prepare("DELETE FROM upload_log WHERE uploaded_at < ?").run(cutoff.toISOString());
  return { poolDeleted: r1.changes, accruedDeleted: r2.changes, logDeleted: r3.changes, cutoff: iso };
}

module.exports = { ingestPool, ingestAccrued, purgeOldSnapshots };
