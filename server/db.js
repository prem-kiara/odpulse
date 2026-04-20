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
`);

module.exports = db;
