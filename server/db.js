// SQLite-backed store for OD snapshots and customer master.
// The existing JSON files (entries.json, users.json, branches.json, config.json,
// notifications.json) are left untouched — this db only holds the new OD data.

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, "odpulse.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  loan_account_no TEXT PRIMARY KEY,
  customer_number TEXT,
  customer_name TEXT,
  spouse_name TEXT,
  branch TEXT,
  center_name TEXT,
  group_name TEXT,
  mobile_number TEXT,
  residence_phone TEXT,
  aadhaar_number TEXT,
  voter_id TEXT,
  ration_card TEXT,
  gender TEXT,
  date_of_birth TEXT,
  officer_name TEXT,
  officer_code TEXT,
  product_name TEXT,
  -- Loan classification from the "Category of Loan" column of the Pool Report.
  -- Values are 'Group Loan' / 'Individual Loan' (free-text, so compared case-
  -- insensitively in queries). Drives the OD Insights Group vs Individual tab split.
  loan_category TEXT,
  product_interest_rate REAL,
  loan_amount REAL,
  disbursement_date TEXT,
  first_installment_date TEXT,
  last_installment_date TEXT,
  last_payment_date TEXT,
  village TEXT,
  district TEXT,
  pincode TEXT,
  address TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_customers_branch ON customers(branch);
CREATE INDEX IF NOT EXISTS idx_customers_customer_number ON customers(customer_number);
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile_number);
CREATE INDEX IF NOT EXISTS idx_customers_aadhaar ON customers(aadhaar_number);

CREATE TABLE IF NOT EXISTS pool_snapshots (
  snapshot_date TEXT NOT NULL,
  loan_account_no TEXT NOT NULL,
  branch TEXT,
  principal_outstanding REAL,
  interest_outstanding REAL,
  principal_overdue REAL,
  interest_overdue REAL,
  current_od REAL,
  overdue_days INTEGER,
  installments_paid INTEGER,
  loan_status TEXT,
  account_dpd_classification TEXT,
  customer_dpd INTEGER,
  customer_dpd_classification TEXT,
  last_payment_amount REAL,
  total_interest_collected REAL,
  PRIMARY KEY (snapshot_date, loan_account_no)
);

CREATE INDEX IF NOT EXISTS idx_pool_snap_loan ON pool_snapshots(loan_account_no);
CREATE INDEX IF NOT EXISTS idx_pool_snap_date ON pool_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_pool_snap_branch ON pool_snapshots(branch);

CREATE TABLE IF NOT EXISTS accrued_snapshots (
  snapshot_date TEXT NOT NULL,
  loan_account_no TEXT NOT NULL,
  branch TEXT,
  principal_outstanding REAL,
  accrued_interest REAL,
  accrued_interest_prev REAL,
  last_installment_date TEXT,
  last_paid_date TEXT,
  PRIMARY KEY (snapshot_date, loan_account_no)
);

CREATE INDEX IF NOT EXISTS idx_accrued_snap_loan ON accrued_snapshots(loan_account_no);
CREATE INDEX IF NOT EXISTS idx_accrued_snap_date ON accrued_snapshots(snapshot_date);

CREATE TABLE IF NOT EXISTS upload_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  filename TEXT,
  snapshot_date TEXT,
  row_count INTEGER,
  new_branches INTEGER,
  uploaded_by TEXT,
  uploaded_at TEXT
);

-- ─── Overdue report ────────────────────────────────────────────────────────
-- Per-account per-snapshot "bad-book" view with NPA dates, installments due,
-- death-case flag, and earliest/latest unpaid demand dates.
CREATE TABLE IF NOT EXISTS od_overdue (
  snapshot_date TEXT NOT NULL,
  loan_account_no TEXT NOT NULL,
  customer_number TEXT,
  customer_name TEXT,
  telephone TEXT,
  guarantor_name TEXT,
  branch_name TEXT,
  branch_code TEXT,
  officer_name TEXT,
  officer_code TEXT,
  center_name TEXT,
  center_code TEXT,
  group_name TEXT,
  date_of_birth TEXT,
  religious_group TEXT,
  caste TEXT,
  locale TEXT,
  state TEXT,
  product TEXT,
  loan_amount REAL,
  loan_cycle INTEGER,
  last_payment_approp_date TEXT,
  last_payment_approp_amount REAL,
  repayment_frequency TEXT,
  maturity_date TEXT,
  interest_rate REAL,
  emi REAL,
  purpose_category TEXT,
  purpose TEXT,
  fund_source TEXT,
  principal_outstanding REAL,
  interest_outstanding REAL,
  fee_insurance_outstanding REAL,
  disbursement_date TEXT,
  installments_due INTEGER,
  earliest_unpaid_demand_date TEXT,
  latest_unpaid_demand_date TEXT,
  principal_default REAL,
  interest_default REAL,
  min_principal_overdue_days INTEGER,
  max_principal_overdue_days INTEGER,
  account_status TEXT,
  death_case_remark TEXT,
  death_flagged_date TEXT,
  moratorium_availed TEXT,
  is_restructured TEXT,
  dpd_classification TEXT,
  npa_date TEXT,
  first_npa_date TEXT,
  current_npa_date TEXT,
  PRIMARY KEY (snapshot_date, loan_account_no)
);

CREATE INDEX IF NOT EXISTS idx_overdue_loan ON od_overdue(loan_account_no);
CREATE INDEX IF NOT EXISTS idx_overdue_date ON od_overdue(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_overdue_branch ON od_overdue(branch_name);
CREATE INDEX IF NOT EXISTS idx_overdue_officer ON od_overdue(officer_code);
CREATE INDEX IF NOT EXISTS idx_overdue_dpd ON od_overdue(dpd_classification);
CREATE INDEX IF NOT EXISTS idx_overdue_first_npa ON od_overdue(first_npa_date);

-- ─── Collections ledger ────────────────────────────────────────────────────
-- Immutable ledger, one row per receipt. INSERT OR IGNORE on receipt_no makes
-- re-uploading the same extract idempotent.
CREATE TABLE IF NOT EXISTS od_collections (
  receipt_no TEXT PRIMARY KEY,
  loan_account_no TEXT,
  customer_number TEXT,
  customer_name TEXT,
  branch_name TEXT,
  branch_code TEXT,
  center_name TEXT,
  center_code TEXT,
  meeting_time TEXT,
  officer_name TEXT,
  officer_code TEXT,
  payment_officer_name TEXT,
  payment_officer_code TEXT,
  username TEXT,
  amount REAL,
  paid_by TEXT,
  payment_date TEXT,
  payment_status TEXT,
  disbursement_date TEXT,
  mode TEXT,
  app_local_posting_time TEXT,
  posting_time TEXT,
  product TEXT,
  payment_app TEXT,
  narration TEXT,
  upi_txn_number TEXT,
  upi_rrn TEXT,
  uploaded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_coll_payment_date ON od_collections(payment_date);
CREATE INDEX IF NOT EXISTS idx_coll_branch ON od_collections(branch_name);
CREATE INDEX IF NOT EXISTS idx_coll_officer ON od_collections(officer_code);
CREATE INDEX IF NOT EXISTS idx_coll_payment_officer ON od_collections(payment_officer_code);
CREATE INDEX IF NOT EXISTS idx_coll_mode ON od_collections(mode);
CREATE INDEX IF NOT EXISTS idx_coll_account ON od_collections(loan_account_no);

-- ─── Client-wise period summary ────────────────────────────────────────────
-- Demand vs Collected per account for a period window (period_start..period_end).
-- Period is taken from the file / caller; dates captured as text YYYY-MM-DD.
CREATE TABLE IF NOT EXISTS od_client_period (
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  loan_account_no TEXT NOT NULL,
  customer_number TEXT,
  customer_name TEXT,
  branch_name TEXT,
  branch_code TEXT,
  center_name TEXT,
  center_code TEXT,
  officer_name TEXT,
  officer_code TEXT,
  product_name TEXT,
  account_status TEXT,
  disbursement_date TEXT,
  closing_date TEXT,
  installments_remaining INTEGER,
  principal_outstanding_start REAL,
  principal_outstanding_mid REAL,
  principal_outstanding_end REAL,
  interest_outstanding REAL,
  principal_demand REAL,
  principal_prepayment REAL,
  interest_prepayment REAL,
  last_principal_demand_date TEXT,
  principal_collected REAL,
  last_principal_collected_date TEXT,
  interest_demand REAL,
  last_interest_demand_date TEXT,
  interest_collected REAL,
  differential_interest REAL,
  last_interest_collected_date TEXT,
  other_charges REAL,
  moratorium_interest_collection REAL,
  total_collection REAL,
  advance_amount REAL,
  principal_overdue REAL,
  interest_overdue REAL,
  funder_name TEXT,
  fund_source_name TEXT,
  PRIMARY KEY (period_start, period_end, loan_account_no)
);

CREATE INDEX IF NOT EXISTS idx_cp_branch ON od_client_period(branch_name);
CREATE INDEX IF NOT EXISTS idx_cp_officer ON od_client_period(officer_code);
CREATE INDEX IF NOT EXISTS idx_cp_funder ON od_client_period(funder_name);
CREATE INDEX IF NOT EXISTS idx_cp_product ON od_client_period(product_name);
CREATE INDEX IF NOT EXISTS idx_cp_period_end ON od_client_period(period_end);
CREATE INDEX IF NOT EXISTS idx_cp_loan ON od_client_period(loan_account_no);

-- ─── Monthly rollups (NEVER purged) ───────────────────────────────────────
-- The daily snapshot tables (pool_snapshots / accrued_snapshots / od_overdue)
-- are purged after 90 days. To preserve long-horizon insights, a nightly job
-- rolls the LATEST snapshot of each calendar month into these tables before
-- the purge runs. These tables are the source of truth for any analytic that
-- looks back more than 90 days.
--
-- year_month is TEXT in "YYYY-MM" form (simple to sort, easy to join).

-- Account-level pool: one row per (year_month, loan_account_no) = the last
-- pool_snapshot seen in that month for that loan.
CREATE TABLE IF NOT EXISTS pool_monthly_account (
  year_month TEXT NOT NULL,
  loan_account_no TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  branch TEXT,
  principal_outstanding REAL,
  interest_outstanding REAL,
  principal_overdue REAL,
  interest_overdue REAL,
  current_od REAL,
  overdue_days INTEGER,
  installments_paid INTEGER,
  loan_status TEXT,
  account_dpd_classification TEXT,
  customer_dpd INTEGER,
  customer_dpd_classification TEXT,
  last_payment_amount REAL,
  total_interest_collected REAL,
  PRIMARY KEY (year_month, loan_account_no)
);

CREATE INDEX IF NOT EXISTS idx_pma_branch ON pool_monthly_account(branch);
CREATE INDEX IF NOT EXISTS idx_pma_ym ON pool_monthly_account(year_month);
CREATE INDEX IF NOT EXISTS idx_pma_dpd ON pool_monthly_account(account_dpd_classification);

-- Aggregated pool: one row per (year_month, branch, dpd_bucket) for fast
-- dashboards and long-horizon trend charts.
CREATE TABLE IF NOT EXISTS pool_monthly_agg (
  year_month TEXT NOT NULL,
  branch TEXT NOT NULL,
  dpd_bucket TEXT NOT NULL,           -- '0', '1-30', '31-60', '61-90', '91-180', '180+'
  account_count INTEGER,
  principal_outstanding REAL,
  interest_outstanding REAL,
  principal_overdue REAL,
  interest_overdue REAL,
  current_od REAL,
  PRIMARY KEY (year_month, branch, dpd_bucket)
);

CREATE INDEX IF NOT EXISTS idx_pmagg_ym ON pool_monthly_agg(year_month);
CREATE INDEX IF NOT EXISTS idx_pmagg_branch ON pool_monthly_agg(branch);

-- Account-level overdue (delinquent book history).
CREATE TABLE IF NOT EXISTS overdue_monthly_account (
  year_month TEXT NOT NULL,
  loan_account_no TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  customer_number TEXT,
  customer_name TEXT,
  branch_name TEXT,
  branch_code TEXT,
  officer_code TEXT,
  principal_outstanding REAL,
  interest_outstanding REAL,
  installments_due INTEGER,
  principal_default REAL,
  interest_default REAL,
  min_principal_overdue_days INTEGER,
  max_principal_overdue_days INTEGER,
  dpd_classification TEXT,
  first_npa_date TEXT,
  current_npa_date TEXT,
  account_status TEXT,
  death_case_remark TEXT,
  PRIMARY KEY (year_month, loan_account_no)
);

CREATE INDEX IF NOT EXISTS idx_oma_branch ON overdue_monthly_account(branch_name);
CREATE INDEX IF NOT EXISTS idx_oma_ym ON overdue_monthly_account(year_month);
CREATE INDEX IF NOT EXISTS idx_oma_officer ON overdue_monthly_account(officer_code);
CREATE INDEX IF NOT EXISTS idx_oma_dpd ON overdue_monthly_account(dpd_classification);

-- Aggregated overdue: (year_month, branch, dpd_bucket).
CREATE TABLE IF NOT EXISTS overdue_monthly_agg (
  year_month TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  dpd_bucket TEXT NOT NULL,
  account_count INTEGER,
  principal_default REAL,
  interest_default REAL,
  principal_outstanding REAL,
  interest_outstanding REAL,
  PRIMARY KEY (year_month, branch_name, dpd_bucket)
);

CREATE INDEX IF NOT EXISTS idx_omagg_ym ON overdue_monthly_agg(year_month);

-- Account-level accrued snapshot (month-end accrued interest).
CREATE TABLE IF NOT EXISTS accrued_monthly_account (
  year_month TEXT NOT NULL,
  loan_account_no TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  branch TEXT,
  principal_outstanding REAL,
  accrued_interest REAL,
  accrued_interest_prev REAL,
  last_installment_date TEXT,
  last_paid_date TEXT,
  PRIMARY KEY (year_month, loan_account_no)
);

CREATE INDEX IF NOT EXISTS idx_ama_ym ON accrued_monthly_account(year_month);
CREATE INDEX IF NOT EXISTS idx_ama_branch ON accrued_monthly_account(branch);

-- Rollup run log — trail of when each rollup executed and what it touched.
CREATE TABLE IF NOT EXISTS rollup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  pool_account_rows INTEGER,
  pool_agg_rows INTEGER,
  overdue_account_rows INTEGER,
  overdue_agg_rows INTEGER,
  accrued_account_rows INTEGER,
  months_covered TEXT,              -- comma-joined list of YYYY-MM values
  duration_ms INTEGER,
  trigger TEXT                      -- 'cron' | 'manual' | 'startup'
);
`);

// ─── Idempotent schema migrations ──────────────────────────────────────────
// For databases created before a column was added, ALTER TABLE ADD COLUMN.
// SQLite throws "duplicate column name" if it already exists, which we swallow.
function safeAddColumn(table, column, type) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}

// Pool-Report "Category of Loan" — backfills on next upload, NULL for legacy rows.
safeAddColumn("customers", "loan_category", "TEXT");
// Index for fast Group/Individual filtering in OD Insights.
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_loan_category ON customers(loan_category)`); } catch {}

module.exports = db;
