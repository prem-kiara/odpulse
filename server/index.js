const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const multer = require("multer");
const iconv = require("iconv-lite");

const db = require("./db");
const { ingestPool, ingestAccrued, purgeOldSnapshots } = require("./ingest");

const app = express();
const PORT = 3001;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_TMP_DIR = path.join(__dirname, "uploads");
const BRANCHES_FILE = path.join(DATA_DIR, "branches.json");
const RETENTION_DAYS = 90;
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024; // 150 MB

// ─── Ensure data + upload directories exist ─────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_TMP_DIR)) fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

// ─── Default data ───────────────────────────────────────────────────────────
const DEFAULT_BRANCHES = [
  "Head Office", "Annur", "Thondamuthur", "Kinathukadavu", "Palladam", "Ganapathy",
  "Gobichettipalayam", "Paramathivelur", "Tiruchengode", "Kattuputhur", "Kulithalai",
  "Rasipuram", "Ambai", "Alangulam", "Surandai", "Tenkasi", "Eral", "Tuticorin",
  "Palayamkottai", "Rajapalayam", "Sanakarankovil", "Srivilliputhur", "Periyakulam",
  "Chinnamanur", "Kariyapatti", "RR Nagar", "Thirupuvanam", "Valayankulam", "Checkanurani"
];

const DEFAULT_USERS = [
  { id: "admin", username: "admin", password: "admin123", role: "admin", name: "Administrator", branch: "Head Office", active: true, mustChangePassword: false },
  { id: "u_vijila", username: "vijila", password: "Dhanam@123", role: "staff", name: "Vijila", branch: "", active: true, mustChangePassword: true },
  { id: "u_padmapriya", username: "padmapriya", password: "Dhanam@123", role: "staff", name: "Padmapriya", branch: "", active: true, mustChangePassword: true },
  { id: "u_sasikala", username: "sasikala", password: "Dhanam@123", role: "staff", name: "Sasikala", branch: "", active: true, mustChangePassword: true },
  { id: "u_kaviya", username: "kaviya", password: "Dhanam@123", role: "staff", name: "Kaviya", branch: "", active: true, mustChangePassword: true },
  { id: "u_sandhiya", username: "sandhiya", password: "Dhanam@123", role: "staff", name: "Sandhiya", branch: "", active: true, mustChangePassword: true },
  { id: "u_poongodi", username: "poongodi", password: "Dhanam@123", role: "staff", name: "Poongodi", branch: "", active: true, mustChangePassword: true },
  { id: "u_kersiyal", username: "kersiyal", password: "Dhanam@123", role: "staff", name: "Kersiyal", branch: "", active: true, mustChangePassword: true },
  { id: "u_maheshwari", username: "maheshwari", password: "Dhanam@123", role: "staff", name: "Maheshwari", branch: "", active: true, mustChangePassword: true },
  { id: "u_dinesh", username: "dinesh", password: "Dhanam@123", role: "elevated_staff", name: "Dinesh", branch: "Head Office", active: true, mustChangePassword: true },
];

const DEFAULT_CONFIG = { companyName: "OD Pulse - MFI Recovery Tracker", allowStaffEdit: false, allowStaffDelete: false, staffSeeAllBranches: false, odInsightsAccessUserIds: [] };

// ─── File helpers ───────────────────────────────────────────────────────────
function loadJSON(filename, fallback) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
    // First run — write defaults
    saveJSON(filename, fallback);
    return fallback;
  } catch (err) {
    console.error(`Error loading ${filename}:`, err.message);
    return fallback;
  }
}

function saveJSON(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error(`Error saving ${filename}:`, err.message);
  }
}

// ─── Initialize data on first boot ─────────────────────────────────────────
loadJSON("entries.json", []);
loadJSON("users.json", DEFAULT_USERS);
loadJSON("branches.json", DEFAULT_BRANCHES);
loadJSON("config.json", DEFAULT_CONFIG);
loadJSON("notifications.json", []);

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── API Routes ─────────────────────────────────────────────────────────────

// Generic CRUD for each data type
const COLLECTIONS = {
  entries: "entries.json",
  users: "users.json",
  branches: "branches.json",
  config: "config.json",
  notifications: "notifications.json",
};

// ── Specific routes FIRST (before the generic :collection wildcard) ──

// Health check
app.get("/api/health", (req, res) => {
  const entries = loadJSON("entries.json", []);
  const ptpEntries = entries.filter(e => e.ptpDate);
  res.json({
    status: "ok",
    uptime: process.uptime(),
    dataDir: DATA_DIR,
    counts: {
      entries: entries.length,
      ptpEntries: ptpEntries.length,
      users: loadJSON("users.json", []).length,
      branches: loadJSON("branches.json", []).length,
      notifications: loadJSON("notifications.json", []).length,
    }
  });
});

// POST /api/entries/append — append a single entry (used by frontend on save)
app.post("/api/entries/append", async (req, res) => {
  const entries = loadJSON("entries.json", []);
  entries.unshift(req.body);
  saveJSON("entries.json", entries);

  // If this is a PTP entry, send an immediate email notification
  const entry = req.body;
  if (entry.ptpStatus === "pending" && entry.ptpDate) {
    const subject = `OD Pulse - New PTP Entry: ${entry.customerName} (${entry.customerId}) - ${formatDMY(entry.ptpDate)}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px">
        <h2 style="color:#0f766e">OD Pulse - New PTP Entry Created</h2>
        <p>A new Promise to Pay entry has been recorded:</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f9fafb;font-weight:600;width:40%">Customer</td><td style="padding:8px;border:1px solid #ddd">${entry.customerName} (${entry.customerId})</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f9fafb;font-weight:600">Loan Account</td><td style="padding:8px;border:1px solid #ddd">${entry.loanAccountNo}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f9fafb;font-weight:600">Branch</td><td style="padding:8px;border:1px solid #ddd">${entry.branch}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f9fafb;font-weight:600">OD Type</td><td style="padding:8px;border:1px solid #ddd">${entry.odType || "Group OD"}</td></tr>
          ${entry.odType === "Individual OD"
            ? `<tr><td style="padding:8px;border:1px solid #ddd;background:#f9fafb;font-weight:600">OD Amount Due</td><td style="padding:8px;border:1px solid #ddd">Rs. ${entry.amountDue || 0}</td></tr>`
            : `<tr><td style="padding:8px;border:1px solid #ddd;background:#f9fafb;font-weight:600">Group OD Amount</td><td style="padding:8px;border:1px solid #ddd">Rs. ${entry.groupOdAmount || 0}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f9fafb;font-weight:600">Customer Share</td><td style="padding:8px;border:1px solid #ddd">Rs. ${entry.customerShare || 0}</td></tr>`
          }
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f9fafb;font-weight:600">PTP Date & Time</td><td style="padding:8px;border:1px solid #ddd;color:#c2410c;font-weight:600">${formatDMY(entry.ptpDate)} ${entry.ptpTime || ""}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f9fafb;font-weight:600">Recorded By</td><td style="padding:8px;border:1px solid #ddd">${entry.enteredByName || entry.enteredBy}</td></tr>
        </table>
        <p>Please follow up with the customer on the promised date.</p>
        <p style="color:#888;font-size:12px">Automated notification from <a href="https://odpulse.dhanamfinance.com">OD Pulse</a></p>
      </div>
    `;
    for (const recipient of REMINDER_RECIPIENTS) {
      sendEmail(recipient, subject, html).catch(err => console.error("[PTP EMAIL]", err.message));
    }
    console.log(`[PTP] Immediate email sent for PTP entry: ${entry.customerName} (${entry.customerId})`);
  }

  res.json({ ok: true, count: entries.length });
});

// Manual PTP reminder trigger
app.post("/api/ptp-check", async (req, res) => {
  await checkPTPReminders();
  res.json({ ok: true, message: "PTP check completed" });
});

// Test email endpoint
app.post("/api/test-email", async (req, res) => {
  const transporter = createTransporter();
  if (!transporter) return res.status(500).json({ error: "SMTP not configured" });
  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: REMINDER_RECIPIENTS,
      subject: "OD Pulse - Test Email",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px">
          <h2 style="color:#0f766e">OD Pulse - Email Test</h2>
          <p>This is a test email from OD Pulse running on EC2.</p>
          <p>If you received this, the PTP email reminder system is working correctly.</p>
          <p style="color:#888;font-size:12px">Sent at ${new Date().toISOString()} from <a href="https://odpulse.dhanamfinance.com">OD Pulse</a></p>
        </div>
      `,
    });
    console.log("[EMAIL] Test email sent successfully.");
    res.json({ ok: true, message: "Test email sent to " + REMINDER_RECIPIENTS.join(", ") });
  } catch (err) {
    console.error("[EMAIL] Test email failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Customer Lookup ──────────────────────────────────────────────────────────
let customerBaseCache = null;
function getCustomerBase() {
  if (!customerBaseCache) {
    const p = path.join(DATA_DIR, "customer-base.json");
    if (fs.existsSync(p)) {
      try { customerBaseCache = JSON.parse(fs.readFileSync(p, "utf8")); }
      catch (e) { console.error("[CustomerBase] Failed to load:", e.message); customerBaseCache = { byPhone: {}, byAadhaar: {} }; }
    } else {
      customerBaseCache = { byPhone: {}, byAadhaar: {} };
    }
  }
  return customerBaseCache;
}

app.get("/api/customers/lookup", (req, res) => {
  const { phone, aadhaar } = req.query;
  const base = getCustomerBase();
  let customers = [];
  let key = "";
  if (phone) {
    key = String(phone).replace(/\D/g, "");
    customers = (base.byPhone[key] || []).slice();
  } else if (aadhaar) {
    key = String(aadhaar).replace(/\D/g, "");
    customers = (base.byAadhaar[key] || []).slice();
  }

  // Also query the OD SQLite customers table — so customers ingested via the
  // Pool Report are reachable by phone/Aadhaar even if they aren't in the
  // legacy customer-base.json file.
  if (key) {
    try {
      let rows = [];
      if (phone) {
        // mobile_number in OD data may be stored with or without country code / dashes.
        rows = db.prepare(
          "SELECT loan_account_no, customer_number, customer_name, mobile_number, aadhaar_number FROM customers WHERE REPLACE(REPLACE(REPLACE(mobile_number,' ',''),'-',''),'+','') LIKE ?"
        ).all("%" + key + "%");
      } else if (aadhaar) {
        rows = db.prepare(
          "SELECT loan_account_no, customer_number, customer_name, mobile_number, aadhaar_number FROM customers WHERE REPLACE(REPLACE(aadhaar_number,' ',''),'-','') = ?"
        ).all(key);
      }
      // Dedupe against existing customers by loanAccountNo (or customerId fallback).
      const seen = new Set(customers.map(c => (c.loanAccountNo || c.customerId || "").toString()));
      for (const r of rows) {
        const k = (r.loan_account_no || r.customer_number || "").toString();
        if (seen.has(k)) continue;
        seen.add(k);
        customers.push({
          name: r.customer_name || "",
          customerId: r.customer_number || "",
          loanAccountNo: r.loan_account_no || "",
          aadhaar: r.aadhaar_number || "",
          phone: r.mobile_number || "",
        });
      }
    } catch (e) {
      console.error("[customers/lookup] OD fallback failed:", e.message);
    }
  }

  res.json({ found: customers.length > 0, customers });
});

// ─── OD Recovery (Pool + Accrued Interest) ─────────────────────────────────
// Gating: frontend only allows admin/elevated_staff to reach upload UI; the
// server additionally honours an `x-od-role` header on uploads as a belt-and-
// suspenders check. Read endpoints are unrestricted (same pattern as existing
// /api/:collection routes).

// Disk-backed storage so 100+ MB uploads don't sit in Node's heap.
// Files land in server/uploads/ and are unlinked after processing.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_TMP_DIR),
  filename: (req, file, cb) => {
    const safe = String(file.originalname || "upload").replace(/[^A-Za-z0-9_.-]+/g, "_");
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safe}`);
  },
});

// Reject anything that isn't a CSV/TXT at the multer level so garbage
// (exe, pdf, xlsx, etc.) never touches disk.
function csvFileFilter(req, file, cb) {
  const name = String(file.originalname || "").toLowerCase();
  const ok =
    name.endsWith(".csv") ||
    name.endsWith(".txt") ||
    /^text\//.test(file.mimetype) ||
    file.mimetype === "application/vnd.ms-excel" || // some browsers tag CSV as this
    file.mimetype === "application/octet-stream";   // conservative fallback
  if (!ok) {
    const err = new Error(`Only .csv / .txt files are accepted (got ${file.originalname || file.mimetype}).`);
    err.code = "UNSUPPORTED_TYPE";
    return cb(err);
  }
  cb(null, true);
}

const uploader = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: csvFileFilter,
});

// Safely unlink a tmp file; never throws.
function cleanupTmp(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err && err.code !== "ENOENT") {
      console.warn(`[UPLOAD] failed to remove tmp file ${filePath}:`, err.message);
    }
  });
}

// Read an uploaded file and decode it as UTF-8 even when the bank sends
// CP1252/latin1 (common for Tamil/Windows exports). Detects BOM first.
function readUploadAsUtf8(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString("utf8");
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return iconv.decode(buf.slice(2), "utf-16le");
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return iconv.decode(buf.slice(2), "utf-16be");
  }
  // Heuristic: if the buffer decoded as UTF-8 contains U+FFFD (replacement
  // character), it probably isn't UTF-8. Fall back to CP1252 which is a
  // superset of latin1 and the usual Windows-India default.
  const asUtf8 = buf.toString("utf8");
  if (asUtf8.includes("\uFFFD")) {
    return iconv.decode(buf, "win1252");
  }
  return asUtf8;
}

// Wraps multer.single() so Multer errors (file-size, wrong type, disk, etc.)
// always come back as JSON with a meaningful message instead of crashing
// Express into a blank body.
function uploadField(fieldName) {
  return (req, res, next) => {
    uploader.single(fieldName)(req, res, (err) => {
      if (err) {
        console.error(`[UPLOAD:${fieldName}] multer error:`, err);
        let msg = err.message || err.code || "unknown upload error";
        if (err.code === "LIMIT_FILE_SIZE") {
          msg = `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB upload limit.`;
        }
        return res.status(400).json({ error: msg });
      }
      next();
    });
  };
}

function requireUploader(req, res, next) {
  const role = req.header("x-od-role") || "";
  if (role !== "admin" && role !== "elevated_staff") {
    return res.status(403).json({ error: "Only admin or elevated_staff can upload OD data." });
  }
  next();
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

// Accept strict YYYY-MM-DD; reject "yesterday", "2026-13-40", etc.
// Empty/missing value is treated as "today" (existing behaviour).
function validateSnapshotDate(raw) {
  if (raw == null || raw === "") return { ok: true, value: todayIso() };
  const s = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, error: `Invalid snapshotDate "${raw}" — expected YYYY-MM-DD.` };
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    return { ok: false, error: `Invalid calendar date "${raw}".` };
  }
  return { ok: true, value: s };
}

// POST /api/od/pool/upload — ingest Compressed Pool Report (pipe-delimited)
app.post("/api/od/pool/upload", requireUploader, uploadField("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const tmpPath = req.file.path;
  const t0 = Date.now();
  try {
    const dateCheck = validateSnapshotDate(req.body.snapshotDate);
    if (!dateCheck.ok) return res.status(400).json({ error: dateCheck.error });
    const snapshotDate = dateCheck.value;
    const uploadedBy = req.header("x-od-user") || "unknown";
    console.log(`[POOL UPLOAD] ${req.file.originalname} (${(req.file.size/1024/1024).toFixed(2)}MB) for ${snapshotDate}`);
    const text = readUploadAsUtf8(tmpPath);
    const result = ingestPool(text, {
      snapshotDate, branchesFile: BRANCHES_FILE, uploadedBy, filename: req.file.originalname,
    });
    console.log(`[POOL UPLOAD] done in ${Date.now()-t0}ms — ${result.rowCount} rows, ${result.newBranches} new branches`);
    res.json({ ok: true, snapshotDate, ...result });
  } catch (err) {
    console.error("[POOL UPLOAD] error:", err);
    if (!res.headersSent) {
      const code = err.statusCode || 500;
      res.status(code).json({ error: err.message || String(err) });
    }
  } finally {
    cleanupTmp(tmpPath);
  }
});

// POST /api/od/accrued/upload — ingest Interest Accrued Not Due Report (comma)
app.post("/api/od/accrued/upload", requireUploader, uploadField("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const tmpPath = req.file.path;
  const t0 = Date.now();
  try {
    const dateCheck = validateSnapshotDate(req.body.snapshotDate);
    if (!dateCheck.ok) return res.status(400).json({ error: dateCheck.error });
    const snapshotDate = dateCheck.value;
    const uploadedBy = req.header("x-od-user") || "unknown";
    console.log(`[ACCRUED UPLOAD] ${req.file.originalname} (${(req.file.size/1024/1024).toFixed(2)}MB) for ${snapshotDate}`);
    const text = readUploadAsUtf8(tmpPath);
    const result = ingestAccrued(text, {
      snapshotDate, branchesFile: BRANCHES_FILE, uploadedBy, filename: req.file.originalname,
    });
    console.log(`[ACCRUED UPLOAD] done in ${Date.now()-t0}ms — ${result.rowCount} rows, col=${result.currentAccruedColumn}`);
    res.json({ ok: true, snapshotDate, ...result });
  } catch (err) {
    console.error("[ACCRUED UPLOAD] error:", err);
    if (!res.headersSent) {
      const code = err.statusCode || 500;
      res.status(code).json({ error: err.message || String(err) });
    }
  } finally {
    cleanupTmp(tmpPath);
  }
});

// GET /api/od/customer-lookup?loanAccountNo=...  (or customerId=...)
app.get("/api/od/customer-lookup", (req, res) => {
  const loan = String(req.query.loanAccountNo || "").trim();
  const custNum = String(req.query.customerId || "").trim();
  let customer = null;
  if (loan) {
    customer = db.prepare("SELECT * FROM customers WHERE loan_account_no = ?").get(loan);
  }
  if (!customer && custNum) {
    customer = db.prepare("SELECT * FROM customers WHERE customer_number = ? LIMIT 1").get(custNum);
  }
  const lookupLoan = customer?.loan_account_no || loan;
  if (!lookupLoan) return res.status(400).json({ error: "loanAccountNo or customerId required" });

  const latestPool = db.prepare(
    "SELECT * FROM pool_snapshots WHERE loan_account_no = ? ORDER BY snapshot_date DESC LIMIT 1"
  ).get(lookupLoan);
  const latestAccrued = db.prepare(
    "SELECT * FROM accrued_snapshots WHERE loan_account_no = ? ORDER BY snapshot_date DESC LIMIT 1"
  ).get(lookupLoan);

  if (!customer && !latestPool && !latestAccrued) return res.json({ found: false });

  const principalOutstanding = latestPool?.principal_outstanding ?? 0;
  const accruedInterest = latestAccrued?.accrued_interest ?? 0;
  const unpaidInterest = latestPool?.interest_overdue ?? 0; // "Interest OverDue" per user
  const foreclosureValue = principalOutstanding + accruedInterest + unpaidInterest;

  res.json({
    found: true,
    customer: customer || null,
    pool: latestPool || null,
    accrued: latestAccrued || null,
    principalOutstanding,
    accruedInterest,
    unpaidInterest,
    foreclosureValue,
    poolSnapshotDate: latestPool?.snapshot_date || null,
    accruedSnapshotDate: latestAccrued?.snapshot_date || null,
  });
});

// GET /api/od/customers/search?q=&branch=&limit=20
app.get("/api/od/customers/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  const branch = String(req.query.branch || "").trim();
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));
  if (!q && !branch) return res.json({ results: [] });

  let sql = `SELECT loan_account_no, customer_number, customer_name, branch, mobile_number, aadhaar_number
             FROM customers WHERE 1=1`;
  const params = [];
  if (q) {
    sql += ` AND (loan_account_no LIKE ? OR customer_number LIKE ? OR customer_name LIKE ?
                   OR mobile_number LIKE ? OR aadhaar_number LIKE ?)`;
    const pat = `%${q}%`;
    params.push(pat, pat, pat, pat, pat);
  }
  if (branch) { sql += ` AND branch = ?`; params.push(branch); }
  sql += ` LIMIT ?`;
  params.push(limit);
  res.json({ results: db.prepare(sql).all(...params) });
});

// GET /api/od/metrics/dpd-buckets?date=&branch=
app.get("/api/od/metrics/dpd-buckets", (req, res) => {
  const date = req.query.date ||
    db.prepare(`SELECT MAX(snapshot_date) AS d FROM pool_snapshots`).get()?.d;
  if (!date) return res.json({ snapshotDate: null, buckets: [] });
  const branch = String(req.query.branch || "");

  let sql = `SELECT
      CASE
        WHEN overdue_days <= 0 THEN '0-Current'
        WHEN overdue_days BETWEEN 1 AND 30 THEN '1-30'
        WHEN overdue_days BETWEEN 31 AND 60 THEN '31-60'
        WHEN overdue_days BETWEEN 61 AND 90 THEN '61-90'
        WHEN overdue_days BETWEEN 91 AND 180 THEN '91-180'
        ELSE '180+'
      END AS bucket,
      COUNT(*) AS accounts,
      SUM(COALESCE(principal_overdue,0) + COALESCE(interest_overdue,0)) AS overdue_amount,
      SUM(COALESCE(principal_outstanding,0)) AS principal_outstanding
    FROM pool_snapshots WHERE snapshot_date = ?`;
  const params = [date];
  if (branch) { sql += ` AND branch = ?`; params.push(branch); }
  sql += ` GROUP BY bucket
           ORDER BY CASE bucket WHEN '0-Current' THEN 0 WHEN '1-30' THEN 1 WHEN '31-60' THEN 2
                               WHEN '61-90' THEN 3 WHEN '91-180' THEN 4 ELSE 5 END`;
  res.json({ snapshotDate: date, buckets: db.prepare(sql).all(...params) });
});

// GET /api/od/metrics/od-trend?from=&to=&branch=
app.get("/api/od/metrics/od-trend", (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  const branch = String(req.query.branch || "");

  let sql = `SELECT snapshot_date,
      SUM(COALESCE(principal_overdue,0))   AS principal_overdue,
      SUM(COALESCE(interest_overdue,0))    AS interest_overdue,
      SUM(COALESCE(principal_outstanding,0)) AS principal_outstanding,
      COUNT(*) AS accounts
    FROM pool_snapshots WHERE 1=1`;
  const params = [];
  if (from) { sql += ` AND snapshot_date >= ?`; params.push(from); }
  if (to)   { sql += ` AND snapshot_date <= ?`; params.push(to); }
  if (branch) { sql += ` AND branch = ?`; params.push(branch); }
  sql += ` GROUP BY snapshot_date ORDER BY snapshot_date`;
  res.json({ trend: db.prepare(sql).all(...params) });
});

// GET /api/od/metrics/branch-concentration?date=
app.get("/api/od/metrics/branch-concentration", (req, res) => {
  const date = req.query.date ||
    db.prepare(`SELECT MAX(snapshot_date) AS d FROM pool_snapshots`).get()?.d;
  if (!date) return res.json({ snapshotDate: null, branches: [] });
  const branches = db.prepare(`SELECT branch,
      COUNT(*) AS accounts,
      SUM(COALESCE(principal_overdue,0) + COALESCE(interest_overdue,0)) AS overdue_amount,
      SUM(COALESCE(principal_outstanding,0)) AS principal_outstanding
    FROM pool_snapshots WHERE snapshot_date = ?
    GROUP BY branch ORDER BY overdue_amount DESC`).all(date);
  res.json({ snapshotDate: date, branches });
});

// GET /api/od/metrics/non-contactable?branch=
app.get("/api/od/metrics/non-contactable", (req, res) => {
  const branch = String(req.query.branch || "");
  let sql = `SELECT c.loan_account_no, c.customer_name, c.branch, c.mobile_number, c.residence_phone,
                    p.overdue_days, (COALESCE(p.principal_overdue,0)+COALESCE(p.interest_overdue,0)) AS overdue_amount
             FROM customers c
             LEFT JOIN pool_snapshots p ON p.loan_account_no = c.loan_account_no
                 AND p.snapshot_date = (SELECT MAX(snapshot_date) FROM pool_snapshots WHERE loan_account_no = c.loan_account_no)
             WHERE (c.mobile_number IS NULL OR c.mobile_number = '')
               AND (c.residence_phone IS NULL OR c.residence_phone = '')
               AND p.overdue_days > 0`;
  const params = [];
  if (branch) { sql += ` AND c.branch = ?`; params.push(branch); }
  sql += ` ORDER BY overdue_amount DESC LIMIT 500`;
  res.json({ customers: db.prepare(sql).all(...params) });
});

// GET /api/od/metrics/foreclosure-opportunity?threshold=0.5&branch=
app.get("/api/od/metrics/foreclosure-opportunity", (req, res) => {
  const threshold = Math.max(0, Math.min(2, parseFloat(req.query.threshold || "0.5")));
  const branch = String(req.query.branch || "");
  let sql = `WITH latest_pool AS (
      SELECT * FROM pool_snapshots p WHERE snapshot_date = (
        SELECT MAX(snapshot_date) FROM pool_snapshots WHERE loan_account_no = p.loan_account_no
      )
    ), latest_accrued AS (
      SELECT * FROM accrued_snapshots a WHERE snapshot_date = (
        SELECT MAX(snapshot_date) FROM accrued_snapshots WHERE loan_account_no = a.loan_account_no
      )
    )
    SELECT c.loan_account_no, c.customer_name, c.branch, c.mobile_number, c.loan_amount,
      COALESCE(p.principal_outstanding,0) AS principal_outstanding,
      COALESCE(a.accrued_interest,0) AS accrued_interest,
      COALESCE(p.interest_overdue,0) AS unpaid_interest,
      (COALESCE(p.principal_outstanding,0) + COALESCE(a.accrued_interest,0) + COALESCE(p.interest_overdue,0)) AS foreclosure_value,
      p.overdue_days, p.customer_dpd_classification
    FROM customers c
    LEFT JOIN latest_pool p ON p.loan_account_no = c.loan_account_no
    LEFT JOIN latest_accrued a ON a.loan_account_no = c.loan_account_no
    WHERE c.loan_amount > 0
      AND (COALESCE(p.principal_outstanding,0) + COALESCE(a.accrued_interest,0) + COALESCE(p.interest_overdue,0)) > 0
      AND (COALESCE(p.principal_outstanding,0) + COALESCE(a.accrued_interest,0) + COALESCE(p.interest_overdue,0)) <= c.loan_amount * ?`;
  const params = [threshold];
  if (branch) { sql += ` AND c.branch = ?`; params.push(branch); }
  sql += ` ORDER BY foreclosure_value ASC LIMIT 500`;
  res.json({ threshold, customers: db.prepare(sql).all(...params) });
});

// GET /api/od/metrics/efficiency?from=&to=&branch=&granularity=day|week|month
app.get("/api/od/metrics/efficiency", (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || todayIso());
  const branch = String(req.query.branch || "");
  const gran = String(req.query.granularity || "day");

  const entries = loadJSON("entries.json", []);
  const inRange = entries.filter(e => {
    const d = e.ptpPaidDate || e.date;
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (branch && e.branch !== branch) return false;
    return true;
  });

  const paidOf = (e) => Number(e.totalPaidAmount) || Number(e.groupOdPaidAmount) || Number(e.paidAmount) || 0;

  const bucketKey = (iso) => {
    if (!iso) return "";
    if (gran === "month") return iso.slice(0, 7);
    if (gran === "week") {
      const dt = new Date(iso);
      const oneJan = new Date(dt.getUTCFullYear(), 0, 1);
      const week = Math.ceil((((dt - oneJan) / 86400000) + oneJan.getDay() + 1) / 7);
      return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    }
    return iso;
  };

  const map = new Map();
  for (const e of inRange) {
    const key = bucketKey(e.ptpPaidDate || e.date);
    if (!key) continue;
    const b = map.get(key) || { bucket: key, collected: 0, waiver: 0, entries: 0 };
    b.collected += paidOf(e);
    b.waiver += Number(e.groupOdWaiver) || Number(e.waiver) || 0;
    b.entries += 1;
    map.set(key, b);
  }
  const series = Array.from(map.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));

  let openingSql = `SELECT SUM(COALESCE(principal_overdue,0) + COALESCE(interest_overdue,0)) AS book
                    FROM pool_snapshots
                    WHERE snapshot_date = (
                      SELECT MIN(snapshot_date) FROM pool_snapshots WHERE snapshot_date >= ?
                    )`;
  const openingParams = [from || "1900-01-01"];
  if (branch) { openingSql += ` AND branch = ?`; openingParams.push(branch); }
  const openingBook = db.prepare(openingSql).get(...openingParams)?.book || 0;

  const totalCollected = series.reduce((s, b) => s + b.collected, 0);
  const efficiencyPct = openingBook > 0 ? (totalCollected / openingBook) * 100 : null;

  res.json({ granularity: gran, from, to, branch: branch || null, openingBook, totalCollected, efficiencyPct, series });
});

// GET /api/od/metrics/officer-productivity?from=&to=&branch=
app.get("/api/od/metrics/officer-productivity", (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  const branch = String(req.query.branch || "");
  const entries = loadJSON("entries.json", []);
  const filtered = entries.filter(e => {
    const d = e.date;
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (branch && e.branch !== branch) return false;
    return true;
  });
  const paidOf = (e) => Number(e.totalPaidAmount) || Number(e.groupOdPaidAmount) || Number(e.paidAmount) || 0;
  const byOfficer = new Map();
  for (const e of filtered) {
    const key = e.enteredByName || e.enteredBy || "Unknown";
    const o = byOfficer.get(key) || { officer: key, entries: 0, collected: 0, waiver: 0, ptps: 0, ptpsPaid: 0, ptpsMissed: 0 };
    o.entries += 1;
    o.collected += paidOf(e);
    o.waiver += Number(e.groupOdWaiver) || Number(e.waiver) || 0;
    if (e.ptpDate) {
      o.ptps += 1;
      if (e.ptpStatus === "paid") o.ptpsPaid += 1;
      else if (e.ptpDate < todayIso()) o.ptpsMissed += 1;
    }
    byOfficer.set(key, o);
  }
  const officers = Array.from(byOfficer.values()).sort((a, b) => b.collected - a.collected);
  res.json({ officers });
});

// GET /api/od/metrics/ptp-conversion?from=&to=&branch=
app.get("/api/od/metrics/ptp-conversion", (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  const branch = String(req.query.branch || "");
  const entries = loadJSON("entries.json", []).filter(e => e.ptpDate);
  const filtered = entries.filter(e => {
    if (from && e.ptpDate < from) return false;
    if (to && e.ptpDate > to) return false;
    if (branch && e.branch !== branch) return false;
    return true;
  });
  const paid = filtered.filter(e => e.ptpStatus === "paid").length;
  const pending = filtered.filter(e => e.ptpStatus === "pending").length;
  const missed = filtered.filter(e => e.ptpStatus !== "paid" && e.ptpDate < todayIso()).length;
  const conversionPct = filtered.length > 0 ? (paid / filtered.length) * 100 : 0;
  res.json({ totalPTPs: filtered.length, paid, pending, missed, conversionPct });
});

// GET /api/od/upload-history
app.get("/api/od/upload-history", (req, res) => {
  const uploads = db.prepare(`SELECT * FROM upload_log ORDER BY uploaded_at DESC LIMIT 50`).all();
  const latestPool = db.prepare(`SELECT snapshot_date, COUNT(*) AS rows FROM pool_snapshots
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM pool_snapshots)`).get();
  const latestAccrued = db.prepare(`SELECT snapshot_date, COUNT(*) AS rows FROM accrued_snapshots
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM accrued_snapshots)`).get();
  const totalCustomers = db.prepare(`SELECT COUNT(*) AS n FROM customers`).get().n;
  res.json({ uploads, latestPool, latestAccrued, totalCustomers, retentionDays: RETENTION_DAYS });
});

// POST /api/od/retention/run — manual retention trigger (admin)
app.post("/api/od/retention/run", requireUploader, (req, res) => {
  res.json(purgeOldSnapshots(RETENTION_DAYS));
});

// ── Generic CRUD (wildcard — must be LAST) ──

// GET /api/:collection
app.get("/api/:collection", (req, res) => {
  const file = COLLECTIONS[req.params.collection];
  if (!file) return res.status(404).json({ error: "Unknown collection" });
  const fallback = req.params.collection === "config" ? DEFAULT_CONFIG : [];
  res.json(loadJSON(file, fallback));
});

// POST /api/:collection — full replace
app.post("/api/:collection", (req, res) => {
  const file = COLLECTIONS[req.params.collection];
  if (!file) return res.status(404).json({ error: "Unknown collection" });
  saveJSON(file, req.body);
  res.json({ ok: true, count: Array.isArray(req.body) ? req.body.length : 1 });
});

// ─── Email Config ───────────────────────────────────────────────────────────
// Configure your SMTP settings here or via environment variables
const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
};

const REMINDER_RECIPIENTS = ["telecalling@dhanam.finance", "mgmt@dhanam.finance"];
const EMAIL_FROM = process.env.SMTP_FROM || "odpulse@dhanam.finance";

function createTransporter() {
  if (!EMAIL_CONFIG.auth.user || !EMAIL_CONFIG.auth.pass) {
    console.log("[EMAIL] SMTP not configured. Set SMTP_USER and SMTP_PASS env vars.");
    return null;
  }
  return nodemailer.createTransport(EMAIL_CONFIG);
}

async function sendEmail(to, subject, html) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL] Would send to ${to}: ${subject}`);
    return false;
  }
  try {
    await transporter.sendMail({ from: EMAIL_FROM, to, subject, html });
    console.log(`[EMAIL] Sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL] Failed to send to ${to}:`, err.message);
    return false;
  }
}

// ─── Date helpers ───────────────────────────────────────────────────────────
function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function formatDMY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

// ─── PTP Reminder Logic ─────────────────────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

async function checkPTPReminders() {
  console.log(`[PTP] Running PTP check at ${new Date().toISOString()}`);
  const entries = loadJSON("entries.json", []);
  const users = loadJSON("users.json", []);
  const notifications = loadJSON("notifications.json", []);
  const today = todayISO();
  const tomorrow = tomorrowISO();

  const ptpEntries = entries.filter(e =>
    e.ptpDate && (e.ptpDate === today || e.ptpDate === tomorrow)
  );

  if (ptpEntries.length === 0) {
    console.log("[PTP] No PTP entries due today or tomorrow.");
    return;
  }

  console.log(`[PTP] Found ${ptpEntries.length} PTP entries due.`);

  // Find admin user IDs
  const adminIds = users.filter(u => u.role === "admin" || u.role === "elevated_staff").map(u => u.id);

  const newNotifications = [];
  const emailLines = [];

  for (const entry of ptpEntries) {
    const isToday = entry.ptpDate === today;
    const urgency = isToday ? "TODAY" : "TOMORROW";
    const odAmountLabel = entry.odType === "Individual OD" ? (entry.amountDue || "N/A") : (entry.customerShare || entry.groupOdPaidAmount || entry.totalPaidAmount || "N/A");
    const msg = `PTP Reminder (${urgency}): Collect cash payment from ${entry.customerName} (${entry.customerId}) - Branch: ${entry.branch} - OD Type: ${entry.odType || "Group OD"} - PTP Date: ${formatDMY(entry.ptpDate)} - Amount Due: Rs. ${odAmountLabel}`;

    // Check if we already sent this notification today
    const alreadySent = notifications.some(n =>
      n.entryId === entry.id && n.date === today && n.type === "ptp_reminder"
    );
    if (alreadySent) continue;

    // Notify the user who created the entry
    newNotifications.push({
      id: generateId(),
      type: "ptp_reminder",
      message: msg,
      entryId: entry.id,
      userId: entry.enteredBy,
      forUserId: entry.enteredBy,
      date: today,
      read: false,
      ptpDate: entry.ptpDate,
    });

    // Notify all admins
    for (const adminId of adminIds) {
      if (adminId === entry.enteredBy) continue; // avoid duplicate
      newNotifications.push({
        id: generateId(),
        type: "ptp_reminder",
        message: msg,
        entryId: entry.id,
        userId: entry.enteredBy,
        forUserId: adminId,
        date: today,
        read: false,
        ptpDate: entry.ptpDate,
      });
    }

    emailLines.push(`<tr>
      <td style="padding:8px;border:1px solid #ddd">${entry.customerName}</td>
      <td style="padding:8px;border:1px solid #ddd">${entry.customerId}</td>
      <td style="padding:8px;border:1px solid #ddd">${entry.branch}</td>
      <td style="padding:8px;border:1px solid #ddd">${formatDMY(entry.ptpDate)}</td>
      <td style="padding:8px;border:1px solid #ddd">${urgency}</td>
      <td style="padding:8px;border:1px solid #ddd">${entry.enteredByName || entry.enteredBy}</td>
    </tr>`);
  }

  // Save new notifications
  if (newNotifications.length > 0) {
    const allNotifications = [...newNotifications, ...notifications];
    saveJSON("notifications.json", allNotifications);
    console.log(`[PTP] Created ${newNotifications.length} new notifications.`);
  }

  // Send email digest
  if (emailLines.length > 0) {
    const subject = `OD Pulse - PTP Reminder: ${emailLines.length} payment(s) due (${formatDMY(today)})`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px">
        <h2 style="color:#0f766e">OD Pulse - PTP Payment Reminders</h2>
        <p>The following cash payments are due for collection:</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Customer</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">ID</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Branch</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">PTP Date</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Due</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Recorded By</th>
            </tr>
          </thead>
          <tbody>${emailLines.join("")}</tbody>
        </table>
        <p style="margin-top:16px">Please ensure all scheduled collections are followed up.</p>
        <p style="color:#888;font-size:12px">This is an automated reminder from <a href="https://odpulse.dhanamfinance.com">OD Pulse</a>.</p>
      </div>
    `;

    for (const recipient of REMINDER_RECIPIENTS) {
      await sendEmail(recipient, subject, html);
    }
  }
}

// ─── Schedule: Run PTP check at 8:00 AM and 7:00 PM daily ──────────────────
cron.schedule("0 8 * * *", () => { checkPTPReminders(); });
cron.schedule("0 19 * * *", () => { checkPTPReminders(); });

// ─── Schedule: Retention purge of OD snapshots > 90 days at 3:00 AM daily ──
cron.schedule("0 3 * * *", () => {
  const r = purgeOldSnapshots(RETENTION_DAYS);
  console.log(`[RETENTION] Purged snapshots older than ${RETENTION_DAYS} days:`, r);
});

// Also run on server start (catches up after restarts)
setTimeout(() => { checkPTPReminders(); }, 5000);

// ─── Start server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[OD Pulse API] Running on port ${PORT}`);
  console.log(`[OD Pulse API] Data directory: ${DATA_DIR}`);
  console.log(`[OD Pulse API] SMTP configured: ${!!EMAIL_CONFIG.auth.user}`);
});
