const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const multer = require("multer");
const iconv = require("iconv-lite");

const db = require("./db");
const { ingestPool, ingestAccrued, ingestOverdue, ingestCollections, ingestClientPeriod, ingestForeclosure, purgeOldSnapshots, rollupMonthlySnapshots } = require("./ingest");

const app = express();
const PORT = 3001;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_TMP_DIR = path.join(__dirname, "uploads");
const BRANCHES_FILE = path.join(DATA_DIR, "branches.json");
const RETENTION_DAYS = 90;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

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

const DEFAULT_CONFIG = { companyName: "OD Pulse - MFI Recovery Tracker", allowStaffEdit: false, allowStaffDelete: false, staffSeeAllBranches: false, odInsightsAccessUserIds: [], odUploadAccessUserIds: [] };

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
  // Supported lookup keys: phone, aadhaar (numeric/exact) and
  // customerId, loanAccountNo, name (text/partial). Any ONE should be provided.
  const { phone, aadhaar, customerId, loanAccountNo, name } = req.query;
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

  // Also query the OD SQLite customers table. Supports all 5 lookup keys so
  // customers ingested via the OD Upload are reachable by any identifier,
  // even if they aren't in the legacy customer-base.json file.
  try {
    const cols = "loan_account_no, customer_number, customer_name, mobile_number, aadhaar_number, branch";
    let rows = [];
    if (phone && key) {
      // mobile_number in OD data may be stored with or without country code / dashes.
      rows = db.prepare(
        `SELECT ${cols} FROM customers WHERE REPLACE(REPLACE(REPLACE(mobile_number,' ',''),'-',''),'+','') LIKE ?`
      ).all("%" + key + "%");
    } else if (aadhaar && key) {
      rows = db.prepare(
        `SELECT ${cols} FROM customers WHERE REPLACE(REPLACE(aadhaar_number,' ',''),'-','') = ?`
      ).all(key);
    } else if (customerId) {
      const k = String(customerId).trim();
      if (k.length >= 3) {
        rows = db.prepare(
          `SELECT ${cols} FROM customers WHERE customer_number LIKE ? LIMIT 20`
        ).all(k + "%");
      }
    } else if (loanAccountNo) {
      const k = String(loanAccountNo).trim();
      if (k.length >= 3) {
        rows = db.prepare(
          `SELECT ${cols} FROM customers WHERE loan_account_no LIKE ? LIMIT 20`
        ).all(k + "%");
      }
    } else if (name) {
      const k = String(name).trim();
      if (k.length >= 3) {
        rows = db.prepare(
          `SELECT ${cols} FROM customers WHERE customer_name LIKE ? LIMIT 20`
        ).all("%" + k + "%");
      }
    }
    // Enrich each row with phone/aadhaar from a sibling record with the same
    // customer_number when the matched row's fields are empty. Foreclosure-only
    // customers have NULL mobile_number/aadhaar (the foreclosure CSV doesn't
    // contain those columns), but a previous pool ingest may have populated
    // those fields on another loan record for the same person.
    const siblingFill = db.prepare(
      `SELECT mobile_number, aadhaar_number FROM customers
       WHERE customer_number = ? AND loan_account_no != ?
         AND (COALESCE(mobile_number,'') != '' OR COALESCE(aadhaar_number,'') != '')
       LIMIT 1`
    );
    for (const r of rows) {
      if (r.customer_number && (!r.mobile_number || !r.aadhaar_number)) {
        const sib = siblingFill.get(r.customer_number, r.loan_account_no || "");
        if (sib) {
          if (!r.mobile_number && sib.mobile_number) r.mobile_number = sib.mobile_number;
          if (!r.aadhaar_number && sib.aadhaar_number) r.aadhaar_number = sib.aadhaar_number;
        }
      }
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
        branch: r.branch || "",
      });
    }
  } catch (e) {
    console.error("[customers/lookup] SQLite lookup failed:", e.message);
  }

  // ── CSB Bank fallback ─────────────────────────────────────────────────
  // CSB customers (hyphenated loan numbers like 0269-80394391-657201) are
  // NOT in the customers table — they don't come from Pool/Foreclosure
  // reports. Their data only exists in entries.json (where collection
  // officers previously recorded payments). Search there as a fallback
  // so autofill works for these customers too.
  try {
    const isCSBLoan = loanAccountNo && /^\d+-\d+-\d+/.test(String(loanAccountNo).trim());
    const matchKey = (loanAccountNo || customerId || phone || aadhaar || name || "").toString().trim();
    if (matchKey && customers.length === 0) {
      const allEntries = loadJSON("entries.json", []);
      // Score-based matching — pick the most recent entry that matches.
      const matches = allEntries.filter(e => {
        if (loanAccountNo) return (e.loanAccountNo || "").trim() === String(loanAccountNo).trim();
        if (customerId)    return (e.customerId || "").trim() === String(customerId).trim();
        if (phone)         return String(e.phone || "").replace(/\D/g, "") === String(phone).replace(/\D/g, "");
        if (aadhaar)       return String(e.aadhaar || "").replace(/\D/g, "") === String(aadhaar).replace(/\D/g, "");
        if (name)          return (e.customerName || "").toLowerCase().includes(String(name).toLowerCase());
        return false;
      });
      // Group by loanAccountNo, take most recent entry per loan
      const byLoan = new Map();
      for (const e of matches) {
        const loan = (e.loanAccountNo || "").trim();
        if (!loan) continue;
        const prev = byLoan.get(loan);
        if (!prev || (e.date || "") > (prev.date || "")) byLoan.set(loan, e);
      }
      for (const e of byLoan.values()) {
        customers.push({
          name: e.customerName || "",
          customerId: e.customerId || "",
          loanAccountNo: e.loanAccountNo || "",
          aadhaar: e.aadhaar || "",
          phone: e.phone || "",
          branch: e.branch || "",
          isCSBCustomer: !!e.isCSBCustomer || isCSBLoan,
          source: "entries", // marks the result as coming from entries.json (not pool/foreclosure)
          lastEntry: {
            date: e.date,
            amountDue: e.amountDue,
            paidAmount: e.paidAmount,
            odType: e.odType,
          },
        });
      }
    }
  } catch (e) {
    console.error("[customers/lookup] entries.json fallback failed:", e.message);
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
  const userId = req.header("x-od-user") || "";
  // Admin + elevated_staff always allowed. Regular staff can also be granted
  // access via config.odUploadAccessUserIds (managed in the Admin panel).
  if (role === "admin" || role === "elevated_staff") return next();
  if (userId) {
    const cfg = loadJSON("config.json", DEFAULT_CONFIG);
    const allowed = Array.isArray(cfg?.odUploadAccessUserIds) ? cfg.odUploadAccessUserIds : [];
    if (allowed.includes(userId)) return next();
  }
  return res.status(403).json({ error: "You do not have permission to upload OD data. Ask an admin to grant OD Upload access." });
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

// POST /api/od/foreclosure/upload — ingest Foreclosure / closed-loan report (pipe-delimited)
// Mirrors /api/od/pool/upload. Writes to foreclosure_snapshots AND upserts the
// customer master so closed-loan customers show up in /api/customers/lookup.
app.post("/api/od/foreclosure/upload", requireUploader, uploadField("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const tmpPath = req.file.path;
  const t0 = Date.now();
  try {
    const dateCheck = validateSnapshotDate(req.body.snapshotDate);
    if (!dateCheck.ok) return res.status(400).json({ error: dateCheck.error });
    const snapshotDate = dateCheck.value;
    const uploadedBy = req.header("x-od-user") || "unknown";
    console.log(`[FORECLOSURE UPLOAD] ${req.file.originalname} (${(req.file.size/1024/1024).toFixed(2)}MB) for ${snapshotDate}`);
    const text = readUploadAsUtf8(tmpPath);
    const result = ingestForeclosure(text, {
      snapshotDate, branchesFile: BRANCHES_FILE, uploadedBy, filename: req.file.originalname,
    });
    console.log(`[FORECLOSURE UPLOAD] done in ${Date.now()-t0}ms — ${result.rowCount} rows, ${result.newBranches} new branches`);
    res.json({ ok: true, snapshotDate, ...result });
  } catch (err) {
    console.error("[FORECLOSURE UPLOAD] error:", err);
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

// POST /api/od/overdue/upload — ingest Overdue Report (pipe-delimited)
app.post("/api/od/overdue/upload", requireUploader, uploadField("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const t0 = Date.now();
  const tmpPath = req.file.path;
  try {
    const snapshotDate = (req.body.snapshotDate || todayIso()).slice(0, 10);
    const uploadedBy = req.header("x-od-user") || "unknown";
    console.log(`[OVERDUE UPLOAD] ${req.file.originalname} (${(req.file.size/1024/1024).toFixed(2)}MB) for ${snapshotDate}`);
    // Multer uses disk storage (see storage config) so req.file.buffer is
    // undefined — calling .toString() on it throws
    // "Cannot read properties of undefined (reading 'toString')".
    // Read the tmp file from disk instead. readUploadAsUtf8 also handles
    // CP1252/UTF-16 encodings common in Finflux exports.
    const text = readUploadAsUtf8(tmpPath);
    const result = ingestOverdue(text, {
      snapshotDate, branchesFile: BRANCHES_FILE, uploadedBy, filename: req.file.originalname,
    });
    console.log(`[OVERDUE UPLOAD] done in ${Date.now()-t0}ms — ${result.rowCount} rows, ${result.newBranches} new branches`);
    res.json({ ok: true, snapshotDate, ...result });
  } catch (err) {
    console.error("[OVERDUE UPLOAD] error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message || String(err) });
  } finally {
    cleanupTmp(tmpPath);
  }
});

// Helper: pull a yyyy-mm-dd period window from a Finflux filename like
// "CollectionReport_20260401_20260421.csv" or fall back to user-supplied values.
function extractPeriodFromFilename(name) {
  if (!name) return null;
  const m = String(name).match(/(\d{4})(\d{2})(\d{2}).*?(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return {
    periodStart: `${m[1]}-${m[2]}-${m[3]}`,
    periodEnd: `${m[4]}-${m[5]}-${m[6]}`,
  };
}

// Helper: pull the period window from a Client-Wise CSV header by scanning
// "PRINCIPAL OUTSTANDING (DD-MM-YYYY)" columns and using min/max dates.
// This is the authoritative source — it matches what ingest.js already uses
// to build the PO snapshot columns — and lets us ingest files whose name
// doesn't carry a date (e.g. "ClientWiseCollectionReport.csv").
function extractPeriodFromClientWiseHeader(text) {
  const firstLine = (String(text || "").split(/\r?\n/, 1)[0] || "");
  const re = /PRINCIPAL\s+OUTSTANDING\s*\(\s*(\d{1,2})-(\d{1,2})-(\d{4})\s*\)/gi;
  const dates = [];
  let m;
  while ((m = re.exec(firstLine)) !== null) {
    dates.push(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  if (dates.length === 0) return null;
  dates.sort();
  return { periodStart: dates[0], periodEnd: dates[dates.length - 1] };
}

// POST /api/od/collections/upload — ingest Collection Report (pipe-delimited)
// Idempotent per receipt_no so re-uploading the same extract is safe.
app.post("/api/od/collections/upload", requireUploader, uploadField("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const t0 = Date.now();
  const tmpPath = req.file.path;
  try {
    const uploadedBy = req.header("x-od-user") || "unknown";
    console.log(`[COLLECTIONS UPLOAD] ${req.file.originalname} (${(req.file.size/1024/1024).toFixed(2)}MB)`);
    // Multer disk-storage fix: read the uploaded tmp file from req.file.path
    // rather than the (undefined) req.file.buffer. Same pattern as pool/accrued
    // upload routes above.
    const text = readUploadAsUtf8(tmpPath);
    const result = ingestCollections(text, {
      branchesFile: BRANCHES_FILE, uploadedBy, filename: req.file.originalname,
    });
    console.log(`[COLLECTIONS UPLOAD] done in ${Date.now()-t0}ms — ${result.rowsInserted} inserted, ${result.rowsSkipped} duplicates skipped`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[COLLECTIONS UPLOAD] error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message || String(err) });
  } finally {
    cleanupTmp(tmpPath);
  }
});

// POST /api/od/client-period/upload — ingest Client-wise Collection Report
// Period window: request body periodStart/periodEnd, else parse from filename.
app.post("/api/od/client-period/upload", requireUploader, uploadField("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const t0 = Date.now();
  const tmpPath = req.file.path;
  try {
    const uploadedBy = req.header("x-od-user") || "unknown";
    let periodStart = (req.body.periodStart || "").slice(0, 10);
    let periodEnd = (req.body.periodEnd || "").slice(0, 10);

    // 1) Try filename (legacy path, e.g. "...YYYYMMDD_YYYYMMDD.csv")
    if (!periodStart || !periodEnd) {
      const p = extractPeriodFromFilename(req.file.originalname);
      if (p) { periodStart = periodStart || p.periodStart; periodEnd = periodEnd || p.periodEnd; }
    }

    // Read the file. Multer uses disk storage (see the storage config above),
    // so req.file.buffer is undefined — we have to read req.file.path.
    // readUploadAsUtf8 also handles CP1252/UTF-16 bank exports.
    const text = readUploadAsUtf8(tmpPath);

    // 2) Fall back to parsing the CSV header's PRINCIPAL OUTSTANDING (DD-MM-YYYY)
    // columns. This is the preferred path — filename-less uploads like
    // "ClientWiseCollectionReport.csv" still work.
    let periodSource = (periodStart && periodEnd) ? "user-or-filename" : null;
    if (!periodStart || !periodEnd) {
      const p2 = extractPeriodFromClientWiseHeader(text);
      if (p2) {
        periodStart = periodStart || p2.periodStart;
        periodEnd = periodEnd || p2.periodEnd;
        periodSource = "header";
      }
    }

    if (!periodStart || !periodEnd) {
      return res.status(400).json({
        error: "periodStart and periodEnd are required (YYYY-MM-DD) — could not auto-detect from filename or CSV header. Ensure the file has PRINCIPAL OUTSTANDING (DD-MM-YYYY) columns.",
      });
    }
    console.log(`[CLIENT-PERIOD UPLOAD] ${req.file.originalname} (${(req.file.size/1024/1024).toFixed(2)}MB) for ${periodStart}..${periodEnd} [source: ${periodSource || "user-or-filename"}]`);
    const result = ingestClientPeriod(text, {
      periodStart, periodEnd, branchesFile: BRANCHES_FILE, uploadedBy, filename: req.file.originalname,
    });
    console.log(`[CLIENT-PERIOD UPLOAD] done in ${Date.now()-t0}ms — ${result.rowCount} rows, ${result.principalCols} PO snapshot cols`);
    res.json({ ok: true, periodStart, periodEnd, periodSource: periodSource || "user-or-filename", ...result });
  } catch (err) {
    console.error("[CLIENT-PERIOD UPLOAD] error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message || String(err) });
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
  // Foreclosure / closed-loan record. Foreclosed-wins rule: if a row exists
  // here, the loan is treated as Closed regardless of pool snapshot status.
  const latestForeclosure = db.prepare(
    "SELECT * FROM foreclosure_snapshots WHERE loan_account_no = ? ORDER BY snapshot_date DESC LIMIT 1"
  ).get(lookupLoan);

  if (!customer && !latestPool && !latestAccrued && !latestForeclosure) return res.json({ found: false });

  const isClosed = !!latestForeclosure;
  const principalOutstanding = latestPool?.principal_outstanding ?? 0;
  const accruedInterest = latestAccrued?.accrued_interest ?? 0;
  const unpaidInterest = latestPool?.interest_overdue ?? 0; // "Interest OverDue" per user
  const foreclosureValue = principalOutstanding + accruedInterest + unpaidInterest;
  // Authoritative status: Closed wins over whatever pool says.
  const loanStatus = isClosed ? "Closed" : (latestPool?.loan_status || "");

  res.json({
    found: true,
    customer: customer || null,
    pool: latestPool || null,
    accrued: latestAccrued || null,
    foreclosure: latestForeclosure || null,
    isClosed,
    loanStatus,
    principalOutstanding,
    accruedInterest,
    unpaidInterest,
    foreclosureValue,
    poolSnapshotDate: latestPool?.snapshot_date || null,
    accruedSnapshotDate: latestAccrued?.snapshot_date || null,
    foreclosureSnapshotDate: latestForeclosure?.snapshot_date || null,
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

// ───────────────────────────────────────────────────────────────────────────
// Category filter — Group vs Individual split, sourced exclusively from the
// Pool Report's "Category of Loan" column (ingested into customers.loan_category
// by server/ingest.js). Values are 'Group Loan' / 'Individual Loan' in-file;
// matching is case-insensitive on the substring 'GROUP' / 'INDIVIDUAL' so it
// tolerates trailing spaces and minor header variations.
//
//   Group      = customers.loan_category contains 'GROUP'
//   Individual = customers.loan_category contains 'INDIVIDUAL'
//
// Loans where loan_category is NULL/blank (not yet re-uploaded after the schema
// migration) are NOT classified — they appear under neither tab until a Pool
// Report that includes the "Category of Loan" column is re-uploaded.
//
// Returns a SQL fragment like " AND <loanCol> IN (...)" — or "" when category
// is falsy/invalid so existing queries stay unfiltered (default behaviour).
// ───────────────────────────────────────────────────────────────────────────

// SQL subquery that selects loan_account_no from customers matching the category.
// Primary classification is the Pool Report's "Category of Loan" column
// (customers.loan_category). If that's NULL/blank for legacy rows ingested
// before the column existed, fall back to the legacy group_name/center_name
// heuristic so existing data still shows up on the correct tab.
function _customerSubqueryForCategory(cat) {
  if (cat === "group") {
    return `SELECT loan_account_no FROM customers
      WHERE UPPER(COALESCE(loan_category,'')) LIKE '%GROUP%'
         OR (
           (loan_category IS NULL OR loan_category = '')
           AND (
             (group_name IS NOT NULL AND group_name <> '')
             OR (center_name IS NOT NULL AND center_name <> '')
           )
         )`;
  }
  return `SELECT loan_account_no FROM customers
      WHERE UPPER(COALESCE(loan_category,'')) LIKE '%INDIVIDUAL%'
         OR (
           (loan_category IS NULL OR loan_category = '')
           AND (group_name IS NULL OR group_name = '')
           AND (center_name IS NULL OR center_name = '')
         )`;
}

function categoryWhere(category, loanCol) {
  if (!category) return "";
  const cat = String(category).toLowerCase();
  if (cat !== "group" && cat !== "individual") return "";
  return ` AND ${loanCol} IN (${_customerSubqueryForCategory(cat)})`;
}

// JS-side predicate for filtering entries.json rows (which reference loanAccountNo).
// Returns a function (loanAccountNo) => boolean. If category is falsy or invalid,
// returns () => true (i.e. no filtering).
//
// A loan matches iff customers.loan_category (sourced from the Pool Report's
// "Category of Loan" column) contains 'GROUP' / 'INDIVIDUAL' accordingly.
function loanCategoryFilter(category) {
  if (!category) return () => true;
  const cat = String(category).toLowerCase();
  if (cat !== "group" && cat !== "individual") return () => true;

  const matchSet = new Set();
  try {
    const rows = db.prepare(_customerSubqueryForCategory(cat)).all();
    for (const r of rows) {
      const loan = String(r.loan_account_no || "").trim();
      if (loan) matchSet.add(loan);
    }
  } catch (err) {
    console.warn("[loanCategoryFilter] customers lookup failed:", err.message);
  }

  return (loan) => matchSet.has(String(loan || "").trim());
}

// Resolve a requested ?date= to the latest snapshot_date <= it. If date is not
// supplied, returns the global MAX. If date is supplied but no snapshot exists
// on or before it, returns null. This makes UI date pickers tolerant — picking
// any "To" date falls back to the most recent ingested snapshot up to that day.
function resolveSnapshotDate(table, requestedDate) {
  // Whitelist tables we control to avoid SQL injection.
  const ALLOWED = { pool_snapshots: 1, accrued_snapshots: 1, od_overdue: 1, foreclosure_snapshots: 1 };
  if (!ALLOWED[table]) return null;
  if (requestedDate) {
    const row = db.prepare(
      `SELECT MAX(snapshot_date) AS d FROM ${table} WHERE snapshot_date <= ?`
    ).get(String(requestedDate));
    return row?.d || null;
  }
  const row = db.prepare(`SELECT MAX(snapshot_date) AS d FROM ${table}`).get();
  return row?.d || null;
}

// GET /api/od/metrics/dpd-buckets?date=&branch=
app.get("/api/od/metrics/dpd-buckets", (req, res) => {
  const date = resolveSnapshotDate("pool_snapshots", req.query.date);
  if (!date) return res.json({ snapshotDate: null, buckets: [] });
  const branch = String(req.query.branch || "");
  const category = String(req.query.category || "");

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
  sql += categoryWhere(category, "loan_account_no");
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
  const category = String(req.query.category || "");

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
  sql += categoryWhere(category, "loan_account_no");
  sql += ` GROUP BY snapshot_date ORDER BY snapshot_date`;
  res.json({ trend: db.prepare(sql).all(...params) });
});

// GET /api/od/metrics/branch-concentration?date=
app.get("/api/od/metrics/branch-concentration", (req, res) => {
  const date = resolveSnapshotDate("pool_snapshots", req.query.date);
  if (!date) return res.json({ snapshotDate: null, branches: [] });
  const category = String(req.query.category || "");
  let sql = `SELECT branch,
      COUNT(*) AS accounts,
      SUM(COALESCE(principal_overdue,0) + COALESCE(interest_overdue,0)) AS overdue_amount,
      SUM(COALESCE(principal_outstanding,0)) AS principal_outstanding
    FROM pool_snapshots WHERE snapshot_date = ?`;
  const params = [date];
  sql += categoryWhere(category, "loan_account_no");
  sql += ` GROUP BY branch ORDER BY overdue_amount DESC`;
  const branches = db.prepare(sql).all(...params);
  res.json({ snapshotDate: date, branches });
});

// GET /api/od/metrics/non-contactable?branch=
app.get("/api/od/metrics/non-contactable", (req, res) => {
  const branch = String(req.query.branch || "");
  const category = String(req.query.category || "");
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
  sql += categoryWhere(category, "c.loan_account_no");
  sql += ` ORDER BY overdue_amount DESC LIMIT 500`;
  res.json({ customers: db.prepare(sql).all(...params) });
});

// GET /api/od/metrics/foreclosure-opportunity?threshold=0.5&branch=
app.get("/api/od/metrics/foreclosure-opportunity", (req, res) => {
  const threshold = Math.max(0, Math.min(2, parseFloat(req.query.threshold || "0.5")));
  const branch = String(req.query.branch || "");
  const category = String(req.query.category || "");
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
  sql += categoryWhere(category, "c.loan_account_no");
  sql += ` ORDER BY foreclosure_value ASC LIMIT 500`;
  res.json({ threshold, customers: db.prepare(sql).all(...params) });
});

// GET /api/od/metrics/efficiency?from=&to=&branch=&granularity=day|week|month
app.get("/api/od/metrics/efficiency", (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || todayIso());
  const branch = String(req.query.branch || "");
  const gran = String(req.query.granularity || "day");
  const category = String(req.query.category || "");
  const catFilter = loanCategoryFilter(category);

  const entries = loadJSON("entries.json", []);
  const inRange = entries.filter(e => {
    const d = e.ptpPaidDate || e.date;
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (branch && e.branch !== branch) return false;
    if (!catFilter(e.loanAccountNo)) return false;
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
  openingSql += categoryWhere(category, "loan_account_no");
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
  const category = String(req.query.category || "");
  const catFilter = loanCategoryFilter(category);
  const entries = loadJSON("entries.json", []);
  const filtered = entries.filter(e => {
    const d = e.date;
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (branch && e.branch !== branch) return false;
    if (!catFilter(e.loanAccountNo)) return false;
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
  const category = String(req.query.category || "");
  const catFilter = loanCategoryFilter(category);
  const entries = loadJSON("entries.json", []).filter(e => e.ptpDate);
  const filtered = entries.filter(e => {
    if (from && e.ptpDate < from) return false;
    if (to && e.ptpDate > to) return false;
    if (branch && e.branch !== branch) return false;
    if (!catFilter(e.loanAccountNo)) return false;
    return true;
  });
  const paid = filtered.filter(e => e.ptpStatus === "paid").length;
  const pending = filtered.filter(e => e.ptpStatus === "pending").length;
  const missed = filtered.filter(e => e.ptpStatus !== "paid" && e.ptpDate < todayIso()).length;
  const conversionPct = filtered.length > 0 ? (paid / filtered.length) * 100 : 0;
  res.json({ totalPTPs: filtered.length, paid, pending, missed, conversionPct });
});

// ── Analytics endpoints for the new dashboards ─────────────────────────────
// All read-only; no role gating (same as existing metrics endpoints).
//
// Helper: return the latest client-period window (so the UI can default to the
// most recent upload). Used by dashboards that default to "latest period".
function latestPeriod() {
  const row = db.prepare(
    `SELECT period_start, period_end FROM od_client_period
      ORDER BY period_end DESC, period_start DESC LIMIT 1`
  ).get();
  return row || null;
}

// GET /api/od/analytics/periods — list periods we have in client_period table
app.get("/api/od/analytics/periods", (req, res) => {
  const rows = db.prepare(
    `SELECT DISTINCT period_start, period_end FROM od_client_period
      ORDER BY period_end DESC, period_start DESC LIMIT 24`
  ).all();
  res.json({ periods: rows });
});

// GET /api/od/analytics/collection-efficiency?periodStart=&periodEnd=&groupBy=
//   groupBy ∈ branch | officer | product | funder | center
//   Returns: { headline: {demand, collected, cePct}, breakdown: [{group, demand, collected, cePct, accounts}] }
app.get("/api/od/analytics/collection-efficiency", (req, res) => {
  const groupBy = String(req.query.groupBy || "branch").toLowerCase();
  const fieldMap = {
    branch: "branch_name", officer: "officer_name", product: "product_name",
    funder: "funder_name", center: "center_name",
  };
  const col = fieldMap[groupBy] || "branch_name";
  let { periodStart, periodEnd } = req.query;
  const category = String(req.query.category || "");
  if (!periodStart || !periodEnd) {
    const p = latestPeriod();
    if (p) { periodStart = p.period_start; periodEnd = p.period_end; }
  }
  if (!periodStart || !periodEnd) return res.json({ headline: null, breakdown: [], period: null });

  const catClause = categoryWhere(category, "loan_account_no");
  const headline = db.prepare(`
    SELECT
      SUM(principal_demand + interest_demand) AS demand,
      SUM(principal_collected + interest_collected) AS collected,
      SUM(principal_demand) AS principal_demand,
      SUM(principal_collected) AS principal_collected,
      SUM(interest_demand) AS interest_demand,
      SUM(interest_collected) AS interest_collected,
      COUNT(*) AS accounts
    FROM od_client_period
    WHERE period_start = ? AND period_end = ?${catClause}
  `).get(periodStart, periodEnd);
  const cePct = headline && headline.demand > 0 ? (headline.collected / headline.demand) * 100 : 0;

  const breakdown = db.prepare(`
    SELECT
      COALESCE(NULLIF(${col},''),'(unspecified)') AS label,
      SUM(principal_demand + interest_demand) AS demand,
      SUM(principal_collected + interest_collected) AS collected,
      SUM(principal_overdue) AS principal_overdue,
      SUM(interest_overdue) AS interest_overdue,
      COUNT(*) AS accounts
    FROM od_client_period
    WHERE period_start = ? AND period_end = ?${catClause}
    GROUP BY label
    HAVING demand > 0 OR collected > 0 OR principal_overdue > 0
    ORDER BY demand DESC
    LIMIT 500
  `).all(periodStart, periodEnd).map(r => ({
    ...r, cePct: r.demand > 0 ? (r.collected / r.demand) * 100 : 0,
  }));

  res.json({ headline: { ...headline, cePct }, breakdown, period: { periodStart, periodEnd } });
});

// GET /api/od/analytics/officer-scorecard?periodStart=&periodEnd=
// Combines Client-Wise summary (demand/collected) with Collections ledger
// (rupees actually posted, mode mix, cash handled) on officer_code.
app.get("/api/od/analytics/officer-scorecard", (req, res) => {
  let { periodStart, periodEnd } = req.query;
  const category = String(req.query.category || "");
  if (!periodStart || !periodEnd) {
    const p = latestPeriod();
    if (p) { periodStart = p.period_start; periodEnd = p.period_end; }
  }

  const catClauseCP = categoryWhere(category, "loan_account_no");
  // Demand/collected roll-up from client-period (officer owns the account).
  const owned = periodStart && periodEnd ? db.prepare(`
    SELECT
      COALESCE(NULLIF(officer_code,''),'(unknown)') AS officer_code,
      MAX(officer_name) AS officer_name,
      MAX(branch_name) AS branch_name,
      COUNT(*) AS accounts,
      SUM(principal_demand + interest_demand) AS demand,
      SUM(principal_collected + interest_collected) AS collected,
      SUM(principal_overdue + interest_overdue) AS overdue_end,
      SUM(principal_outstanding_start - principal_outstanding_end) AS principal_reduced
    FROM od_client_period
    WHERE period_start = ? AND period_end = ?${catClauseCP}
    GROUP BY officer_code
  `).all(periodStart, periodEnd) : [];

  // Actual receipt activity — credited to the PAYMENT officer (who physically
  // collected), not necessarily the relationship officer.
  const collWhere = ["1=1"];
  const collArgs = [];
  if (periodStart) { collWhere.push("payment_date >= ?"); collArgs.push(periodStart); }
  if (periodEnd)   { collWhere.push("payment_date <= ?"); collArgs.push(periodEnd); }
  const collWhereSql = "WHERE " + collWhere.join(" AND ") + categoryWhere(category, "loan_account_no");
  const posted = db.prepare(`
    SELECT
      COALESCE(NULLIF(payment_officer_code,''),'(unknown)') AS officer_code,
      MAX(payment_officer_name) AS officer_name,
      COUNT(*) AS receipts,
      SUM(amount) AS posted_amount,
      SUM(CASE WHEN UPPER(mode)='CASH' THEN amount ELSE 0 END) AS cash_amount,
      SUM(CASE WHEN UPPER(mode) IN ('UPI','BHIM','PHONE PE','GPAY','PAYTM') THEN amount ELSE 0 END) AS upi_amount,
      SUM(CASE WHEN UPPER(mode) IN ('CHEQUE','CHECK','DD') THEN amount ELSE 0 END) AS cheque_amount,
      SUM(CASE WHEN mode IS NULL OR mode='' THEN amount ELSE 0 END) AS unknown_mode_amount
    FROM od_collections
    ${collWhereSql}
    GROUP BY officer_code
  `).all(...collArgs);

  // Merge by officer_code.
  const byCode = new Map();
  for (const o of owned) {
    byCode.set(o.officer_code, { ...o, receipts: 0, posted_amount: 0, cash_amount: 0, upi_amount: 0, cheque_amount: 0, unknown_mode_amount: 0 });
  }
  for (const p of posted) {
    const existing = byCode.get(p.officer_code) || {
      officer_code: p.officer_code, officer_name: p.officer_name, branch_name: "",
      accounts: 0, demand: 0, collected: 0, overdue_end: 0, principal_reduced: 0,
    };
    existing.receipts = p.receipts;
    existing.posted_amount = p.posted_amount;
    existing.cash_amount = p.cash_amount;
    existing.upi_amount = p.upi_amount;
    existing.cheque_amount = p.cheque_amount;
    existing.unknown_mode_amount = p.unknown_mode_amount;
    if (!existing.officer_name) existing.officer_name = p.officer_name;
    byCode.set(p.officer_code, existing);
  }
  const rows = [...byCode.values()].map(r => ({
    ...r,
    cePct: r.demand > 0 ? (r.collected / r.demand) * 100 : null,
    cashPct: r.posted_amount > 0 ? (r.cash_amount / r.posted_amount) * 100 : null,
  })).sort((a, b) => (b.demand || 0) - (a.demand || 0));

  res.json({ rows, period: { periodStart, periodEnd } });
});

// GET /api/od/analytics/daily-collections?from=&to=&branch=
// Day × branch × mode heatmap data for the Daily Collections dashboard.
app.get("/api/od/analytics/daily-collections", (req, res) => {
  const { from, to, branch } = req.query;
  const category = String(req.query.category || "");
  const where = ["1=1"];
  const args = [];
  if (from)   { where.push("payment_date >= ?"); args.push(String(from)); }
  if (to)     { where.push("payment_date <= ?"); args.push(String(to)); }
  if (branch) { where.push("branch_name = ?"); args.push(String(branch)); }
  const whereSql = "WHERE " + where.join(" AND ") + categoryWhere(category, "loan_account_no");

  const byDay = db.prepare(`
    SELECT payment_date AS day,
           COUNT(*) AS receipts,
           SUM(amount) AS total,
           SUM(CASE WHEN UPPER(mode)='CASH' THEN amount ELSE 0 END) AS cash,
           SUM(CASE WHEN UPPER(mode) IN ('UPI','BHIM','PHONE PE','GPAY','PAYTM') THEN amount ELSE 0 END) AS upi,
           SUM(CASE WHEN UPPER(mode) IN ('CHEQUE','CHECK','DD') THEN amount ELSE 0 END) AS cheque,
           SUM(CASE WHEN mode IS NULL OR mode='' THEN amount ELSE 0 END) AS unknown_mode
    FROM od_collections
    ${whereSql}
    GROUP BY payment_date
    ORDER BY payment_date ASC
  `).all(...args);

  const byBranch = db.prepare(`
    SELECT COALESCE(NULLIF(branch_name,''),'(unspecified)') AS branch,
           COUNT(*) AS receipts,
           SUM(amount) AS total,
           SUM(CASE WHEN UPPER(mode)='CASH' THEN amount ELSE 0 END) AS cash,
           SUM(CASE WHEN UPPER(mode) IN ('UPI','BHIM','PHONE PE','GPAY','PAYTM') THEN amount ELSE 0 END) AS upi,
           SUM(CASE WHEN UPPER(mode) IN ('CHEQUE','CHECK','DD') THEN amount ELSE 0 END) AS cheque
    FROM od_collections
    ${whereSql}
    GROUP BY branch
    ORDER BY total DESC
    LIMIT 200
  `).all(...args);

  const modeMix = db.prepare(`
    SELECT COALESCE(NULLIF(mode,''),'(unspecified)') AS mode,
           COUNT(*) AS receipts,
           SUM(amount) AS total
    FROM od_collections
    ${whereSql}
    GROUP BY mode
    ORDER BY total DESC
  `).all(...args);

  res.json({ byDay, byBranch, modeMix });
});

// GET /api/od/analytics/npa-ageing?snapshotDate=  (defaults to latest)
// Returns: buckets of NPA duration (first NPA → today) and top stranded accounts.
app.get("/api/od/analytics/npa-ageing", (req, res) => {
  let snap = String(req.query.snapshotDate || "").slice(0, 10);
  const category = String(req.query.category || "");
  if (!snap) {
    const r = db.prepare(`SELECT MAX(snapshot_date) AS d FROM od_overdue`).get();
    snap = r && r.d ? r.d : "";
  }
  if (!snap) return res.json({ snapshotDate: null, buckets: [], top: [] });

  const rows = db.prepare(`
    SELECT loan_account_no, customer_name, branch_name, officer_name, principal_outstanding,
           interest_outstanding, first_npa_date, current_npa_date, dpd_classification,
           installments_due, max_principal_overdue_days
    FROM od_overdue WHERE snapshot_date = ? AND UPPER(dpd_classification) = 'NPA'${categoryWhere(category, "loan_account_no")}
  `).all(snap);

  const today = new Date(snap);
  const bucketize = (months) => {
    if (months == null || !Number.isFinite(months)) return "Unknown";
    if (months < 3) return "0-3 months";
    if (months < 6) return "3-6 months";
    if (months < 12) return "6-12 months";
    if (months < 24) return "12-24 months";
    return "24+ months";
  };
  const counts = new Map();
  const stranded = [];
  for (const r of rows) {
    let months = null;
    if (r.first_npa_date) {
      const d = new Date(r.first_npa_date);
      if (!isNaN(d)) months = Math.max(0, (today - d) / (1000 * 60 * 60 * 24 * 30.44));
    }
    const bucket = bucketize(months);
    const cur = counts.get(bucket) || { bucket, accounts: 0, principal: 0, interest: 0 };
    cur.accounts++;
    cur.principal += r.principal_outstanding || 0;
    cur.interest += r.interest_outstanding || 0;
    counts.set(bucket, cur);
    stranded.push({ ...r, monthsAsNpa: months });
  }
  const ORDER = ["0-3 months","3-6 months","6-12 months","12-24 months","24+ months","Unknown"];
  const buckets = ORDER.map(b => counts.get(b)).filter(Boolean);
  stranded.sort((a, b) => (b.monthsAsNpa || 0) - (a.monthsAsNpa || 0));
  res.json({ snapshotDate: snap, buckets, top: stranded.slice(0, 100), totalNpaAccounts: rows.length });
});

// GET /api/od/analytics/death-cases?snapshotDate=
app.get("/api/od/analytics/death-cases", (req, res) => {
  let snap = String(req.query.snapshotDate || "").slice(0, 10);
  const category = String(req.query.category || "");
  if (!snap) {
    const r = db.prepare(`SELECT MAX(snapshot_date) AS d FROM od_overdue`).get();
    snap = r && r.d ? r.d : "";
  }
  if (!snap) return res.json({ snapshotDate: null, rows: [] });
  const rows = db.prepare(`
    SELECT loan_account_no, customer_name, branch_name, officer_name, guarantor_name,
           principal_outstanding, interest_outstanding, fee_insurance_outstanding,
           death_case_remark, death_flagged_date, dpd_classification, product
    FROM od_overdue
    WHERE snapshot_date = ? AND (death_case_remark != '' OR death_flagged_date != '')${categoryWhere(category, "loan_account_no")}
    ORDER BY death_flagged_date DESC, principal_outstanding DESC
  `).all(snap);
  const totals = rows.reduce((a, r) => ({
    accounts: a.accounts + 1,
    principal: a.principal + (r.principal_outstanding || 0),
    interest: a.interest + (r.interest_outstanding || 0),
  }), { accounts: 0, principal: 0, interest: 0 });
  res.json({ snapshotDate: snap, rows, totals });
});

// GET /api/od/analytics/installments-due?snapshotDate=
// Bucketed distribution of # Installments Due for action playbook triage.
app.get("/api/od/analytics/installments-due", (req, res) => {
  let snap = String(req.query.snapshotDate || "").slice(0, 10);
  const category = String(req.query.category || "");
  if (!snap) {
    const r = db.prepare(`SELECT MAX(snapshot_date) AS d FROM od_overdue`).get();
    snap = r && r.d ? r.d : "";
  }
  if (!snap) return res.json({ snapshotDate: null, buckets: [] });
  const rows = db.prepare(`
    SELECT installments_due AS n, COUNT(*) AS accounts,
           SUM(principal_outstanding) AS principal,
           SUM(interest_outstanding) AS interest
    FROM od_overdue WHERE snapshot_date = ?${categoryWhere(category, "loan_account_no")} GROUP BY installments_due
  `).all(snap);
  const buckets = [
    { bucket: "1 installment", min: 1, max: 1, accounts: 0, principal: 0, interest: 0 },
    { bucket: "2-3 installments", min: 2, max: 3, accounts: 0, principal: 0, interest: 0 },
    { bucket: "4-6 installments", min: 4, max: 6, accounts: 0, principal: 0, interest: 0 },
    { bucket: "7-12 installments", min: 7, max: 12, accounts: 0, principal: 0, interest: 0 },
    { bucket: "13+ installments", min: 13, max: 999, accounts: 0, principal: 0, interest: 0 },
  ];
  for (const r of rows) {
    const n = r.n || 0;
    if (n < 1) continue;
    const b = buckets.find(b => n >= b.min && n <= b.max);
    if (!b) continue;
    b.accounts += r.accounts;
    b.principal += r.principal || 0;
    b.interest += r.interest || 0;
  }
  res.json({ snapshotDate: snap, buckets });
});

// GET /api/od/analytics/funder-mix?periodStart=&periodEnd=
app.get("/api/od/analytics/funder-mix", (req, res) => {
  let { periodStart, periodEnd } = req.query;
  const category = String(req.query.category || "");
  if (!periodStart || !periodEnd) {
    const p = latestPeriod();
    if (p) { periodStart = p.period_start; periodEnd = p.period_end; }
  }
  if (!periodStart || !periodEnd) return res.json({ rows: [], period: null });
  const rows = db.prepare(`
    SELECT
      COALESCE(NULLIF(funder_name,''),'(unspecified)') AS funder,
      COALESCE(NULLIF(fund_source_name,''),'(unspecified)') AS fund_source,
      COUNT(*) AS accounts,
      SUM(principal_demand + interest_demand) AS demand,
      SUM(principal_collected + interest_collected) AS collected,
      SUM(principal_overdue + interest_overdue) AS overdue_end,
      SUM(principal_outstanding_end) AS principal_outstanding_end
    FROM od_client_period
    WHERE period_start = ? AND period_end = ?${categoryWhere(category, "loan_account_no")}
    GROUP BY funder, fund_source
    ORDER BY principal_outstanding_end DESC
  `).all(periodStart, periodEnd).map(r => ({
    ...r, cePct: r.demand > 0 ? (r.collected / r.demand) * 100 : null,
  }));
  res.json({ rows, period: { periodStart, periodEnd } });
});

// GET /api/od/analytics/recovery-velocity?periodStart=&periodEnd=&limit=50
// Top accounts by principal reduction over the period (real recovery).
app.get("/api/od/analytics/recovery-velocity", (req, res) => {
  let { periodStart, periodEnd } = req.query;
  const category = String(req.query.category || "");
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 500);
  if (!periodStart || !periodEnd) {
    const p = latestPeriod();
    if (p) { periodStart = p.period_start; periodEnd = p.period_end; }
  }
  if (!periodStart || !periodEnd) return res.json({ rows: [], period: null });
  const rows = db.prepare(`
    SELECT loan_account_no, customer_name, branch_name, officer_name, product_name,
           principal_outstanding_start, principal_outstanding_end,
           (principal_outstanding_start - principal_outstanding_end) AS principal_reduced,
           principal_collected, interest_collected, total_collection,
           advance_amount, principal_overdue, interest_overdue
    FROM od_client_period
    WHERE period_start = ? AND period_end = ?${categoryWhere(category, "loan_account_no")}
    ORDER BY principal_reduced DESC
    LIMIT ?
  `).all(periodStart, periodEnd, limit);
  res.json({ rows, period: { periodStart, periodEnd } });
});

// ═══════════════════════════════════════════════════════════════════════════
//  MONTHLY COLLECTIONS
//  Calendar-month rollup of demand vs collected from od_client_period.
//  A "month" here is substr(period_end, 1, 7) = YYYY-MM, so periods that end
//  in the same calendar month are summed together. Read-only; no changes to
//  ingest or existing data.
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/od/analytics/monthly-collections/summary?limit=36
// Returns one row per calendar month with demand/collected per category and
// the shortfall (remaining = demand - collected) per category.
app.get("/api/od/analytics/monthly-collections/summary", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "36", 10), 120);
  const category = String(req.query.category || "");
  // Note: "collected" here is NET of prepayments — i.e. the demand-portion of
  // cash received. Raw collected (incl. prepayments) is exposed as
  // principal_collected_gross / interest_collected_gross for transparency.
  const rows = db.prepare(`
    SELECT
      substr(period_end, 1, 7) AS year_month,
      MIN(period_start) AS period_start_min,
      MAX(period_end) AS period_end_max,
      COUNT(*) AS accounts,
      COUNT(DISTINCT loan_account_no) AS unique_accounts,
      SUM(principal_demand) AS principal_demand,
      SUM(principal_collected) AS principal_collected_gross,
      SUM(COALESCE(principal_prepayment, 0)) AS principal_prepayment,
      SUM(principal_collected - COALESCE(principal_prepayment, 0)) AS principal_collected,
      SUM(interest_demand) AS interest_demand,
      SUM(interest_collected) AS interest_collected_gross,
      SUM(COALESCE(interest_prepayment, 0)) AS interest_prepayment,
      SUM(interest_collected - COALESCE(interest_prepayment, 0)) AS interest_collected,
      SUM(principal_demand + interest_demand) AS total_demand,
      SUM((principal_collected - COALESCE(principal_prepayment, 0))
        + (interest_collected - COALESCE(interest_prepayment, 0))) AS total_collected,
      SUM(principal_collected + interest_collected) AS total_collected_gross,
      SUM(principal_overdue) AS principal_overdue_end,
      SUM(interest_overdue) AS interest_overdue_end
    FROM od_client_period
    WHERE period_end IS NOT NULL AND period_end <> ''${categoryWhere(category, "loan_account_no")}
    GROUP BY year_month
    ORDER BY year_month DESC
    LIMIT ?
  `).all(limit).map(r => {
    const principal_demand   = Number(r.principal_demand || 0);
    const principal_collected = Number(r.principal_collected || 0);
    const interest_demand    = Number(r.interest_demand || 0);
    const interest_collected = Number(r.interest_collected || 0);
    const total_demand       = Number(r.total_demand || 0);
    const total_collected    = Number(r.total_collected || 0);
    const remaining_principal = Math.max(0, principal_demand - principal_collected);
    const remaining_interest  = Math.max(0, interest_demand - interest_collected);
    return {
      ...r,
      remaining_principal,
      remaining_interest,
      // Total remaining = sum of per-category shortfalls so the headline stays
      // consistent with the P/I subtotals.
      remaining_total:     remaining_principal + remaining_interest,
      // CE% is bounded at 100 because "collected" is net of prepayments.
      ce_pct:              total_demand > 0 ? Math.min(100, (total_collected / total_demand) * 100) : 0,
      principal_ce_pct:    principal_demand > 0 ? Math.min(100, (principal_collected / principal_demand) * 100) : 0,
      interest_ce_pct:     interest_demand > 0 ? Math.min(100, (interest_collected / interest_demand) * 100) : 0,
    };
  });
  res.json({ months: rows });
});

// GET /api/od/analytics/monthly-collections/breakdown?yearMonth=YYYY-MM&groupBy=
//   groupBy ∈ branch | product | officer   (defaults to branch)
// Returns one row per group for the selected calendar month with the same
// category split as the summary endpoint.
app.get("/api/od/analytics/monthly-collections/breakdown", (req, res) => {
  const groupBy = String(req.query.groupBy || "branch").toLowerCase();
  const fieldMap = {
    branch:  "branch_name",
    product: "product_name",
    officer: "officer_name",
  };
  const col = fieldMap[groupBy] || "branch_name";
  const category = String(req.query.category || "");

  let { yearMonth } = req.query;
  if (!yearMonth) {
    // default to latest calendar month we have
    const latest = db.prepare(
      `SELECT substr(period_end, 1, 7) AS year_month
         FROM od_client_period
        WHERE period_end IS NOT NULL AND period_end <> ''
        ORDER BY period_end DESC LIMIT 1`
    ).get();
    yearMonth = latest?.year_month || null;
  }
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return res.json({ rows: [], yearMonth: null, groupBy });
  }

  // "Collected" is NET of prepayments (see summary endpoint for rationale).
  const rows = db.prepare(`
    SELECT
      COALESCE(NULLIF(${col},''),'(unspecified)') AS label,
      COUNT(*) AS accounts,
      SUM(principal_demand) AS principal_demand,
      SUM(principal_collected) AS principal_collected_gross,
      SUM(COALESCE(principal_prepayment, 0)) AS principal_prepayment,
      SUM(principal_collected - COALESCE(principal_prepayment, 0)) AS principal_collected,
      SUM(interest_demand) AS interest_demand,
      SUM(interest_collected) AS interest_collected_gross,
      SUM(COALESCE(interest_prepayment, 0)) AS interest_prepayment,
      SUM(interest_collected - COALESCE(interest_prepayment, 0)) AS interest_collected,
      SUM(principal_demand + interest_demand) AS total_demand,
      SUM((principal_collected - COALESCE(principal_prepayment, 0))
        + (interest_collected - COALESCE(interest_prepayment, 0))) AS total_collected,
      SUM(principal_collected + interest_collected) AS total_collected_gross,
      SUM(principal_overdue) AS principal_overdue_end,
      SUM(interest_overdue) AS interest_overdue_end
    FROM od_client_period
    WHERE substr(period_end, 1, 7) = ?${categoryWhere(category, "loan_account_no")}
    GROUP BY label
    HAVING total_demand > 0 OR total_collected > 0
    ORDER BY total_demand DESC
    LIMIT 500
  `).all(yearMonth).map(r => {
    const principal_demand   = Number(r.principal_demand || 0);
    const principal_collected = Number(r.principal_collected || 0);
    const interest_demand    = Number(r.interest_demand || 0);
    const interest_collected = Number(r.interest_collected || 0);
    const total_demand       = Number(r.total_demand || 0);
    const total_collected    = Number(r.total_collected || 0);
    const remaining_principal = Math.max(0, principal_demand - principal_collected);
    const remaining_interest  = Math.max(0, interest_demand - interest_collected);
    return {
      ...r,
      remaining_principal,
      remaining_interest,
      remaining_total:     remaining_principal + remaining_interest,
      ce_pct:              total_demand > 0 ? Math.min(100, (total_collected / total_demand) * 100) : 0,
    };
  });
  res.json({ rows, yearMonth, groupBy });
});

// ═══════════════════════════════════════════════════════════════════════════
//  BRANCH PERFORMANCE / PRODUCT PERFORMANCE / DRILLDOWN
//  Added for the Branch Performance & Product Performance dashboards.
// ═══════════════════════════════════════════════════════════════════════════

// Helper: resolve a "period or latest" pair from query.
function resolvePeriod(req) {
  let { periodStart, periodEnd } = req.query;
  if (!periodStart || !periodEnd) {
    const p = latestPeriod();
    if (p) { periodStart = p.period_start; periodEnd = p.period_end; }
  }
  return { periodStart: periodStart || null, periodEnd: periodEnd || null };
}

// Helper: latest overdue snapshot date (used for NPA/DPD counts).
function latestOverdueSnapshot() {
  const row = db.prepare(`SELECT MAX(snapshot_date) AS d FROM od_overdue`).get();
  return row?.d || null;
}

// GET /api/od/analytics/branch-scorecard?periodStart=&periodEnd=
//   Per-branch scorecard: book, demand, collected, CE%, receipts, cash%,
//   NPA accounts, officers on that branch.
app.get("/api/od/analytics/branch-scorecard", (req, res) => {
  const { periodStart, periodEnd } = resolvePeriod(req);
  const category = String(req.query.category || "");
  if (!periodStart || !periodEnd) return res.json({ rows: [], period: null });
  const catClause = categoryWhere(category, "loan_account_no");

  // Demand + collected + book from client-period
  const core = db.prepare(`
    SELECT
      COALESCE(NULLIF(branch_name,''),'(unspecified)') AS branch,
      COUNT(DISTINCT loan_account_no) AS accounts,
      COUNT(DISTINCT officer_code) AS officers,
      SUM(principal_outstanding_end) AS principal_outstanding,
      SUM(principal_demand + interest_demand) AS demand,
      SUM(principal_collected + interest_collected) AS collected,
      SUM(principal_overdue) AS principal_overdue,
      SUM(interest_overdue) AS interest_overdue,
      SUM(principal_outstanding_start - principal_outstanding_end) AS principal_reduced
    FROM od_client_period
    WHERE period_start = ? AND period_end = ?${catClause}
    GROUP BY branch
  `).all(periodStart, periodEnd);

  // Receipts posted in the same window — payment date based.
  const receipts = db.prepare(`
    SELECT
      COALESCE(NULLIF(branch_name,''),'(unspecified)') AS branch,
      COUNT(*) AS receipts,
      SUM(amount) AS posted_amount,
      SUM(CASE WHEN UPPER(mode)='CASH' THEN amount ELSE 0 END) AS cash_amount,
      SUM(CASE WHEN UPPER(mode) IN ('UPI','DIGITAL','ONLINE') THEN amount ELSE 0 END) AS upi_amount,
      SUM(CASE WHEN UPPER(mode) IN ('CHEQUE','DD') THEN amount ELSE 0 END) AS cheque_amount
    FROM od_collections
    WHERE payment_date >= ? AND payment_date <= ?${catClause}
    GROUP BY branch
  `).all(periodStart, periodEnd);
  const rByBranch = new Map(receipts.map(r => [r.branch, r]));

  // NPA counts from the latest overdue snapshot.
  const snap = latestOverdueSnapshot();
  const npaRows = snap ? db.prepare(`
    SELECT
      COALESCE(NULLIF(branch_name,''),'(unspecified)') AS branch,
      SUM(CASE WHEN first_npa_date IS NOT NULL AND first_npa_date <> '' THEN 1 ELSE 0 END) AS npa_accounts,
      SUM(CASE WHEN dpd_classification IN ('DPD-91-180','DPD-180+','SMA2','NPA') THEN 1 ELSE 0 END) AS severe_accounts
    FROM od_overdue
    WHERE snapshot_date = ?${catClause}
    GROUP BY branch
  `).all(snap) : [];
  const nByBranch = new Map(npaRows.map(r => [r.branch, r]));

  const rows = core.map(c => {
    const r = rByBranch.get(c.branch) || {};
    const n = nByBranch.get(c.branch) || {};
    const cePct = c.demand > 0 ? (c.collected / c.demand) * 100 : null;
    const cashPct = r.posted_amount > 0 ? (r.cash_amount / r.posted_amount) * 100 : null;
    return {
      branch: c.branch,
      accounts: c.accounts || 0,
      officers: c.officers || 0,
      principal_outstanding: c.principal_outstanding || 0,
      demand: c.demand || 0,
      collected: c.collected || 0,
      cePct,
      principal_overdue: c.principal_overdue || 0,
      interest_overdue: c.interest_overdue || 0,
      principal_reduced: c.principal_reduced || 0,
      receipts: r.receipts || 0,
      posted_amount: r.posted_amount || 0,
      cash_amount: r.cash_amount || 0,
      upi_amount: r.upi_amount || 0,
      cheque_amount: r.cheque_amount || 0,
      cashPct,
      npa_accounts: n.npa_accounts || 0,
      severe_accounts: n.severe_accounts || 0,
    };
  }).sort((a, b) => b.principal_outstanding - a.principal_outstanding);

  res.json({ rows, period: { periodStart, periodEnd }, snapshotDate: snap });
});

// GET /api/od/analytics/product-scorecard?periodStart=&periodEnd=
//   Per-product roll-up: accounts, book, demand, collected, CE%, NPA.
app.get("/api/od/analytics/product-scorecard", (req, res) => {
  const { periodStart, periodEnd } = resolvePeriod(req);
  const category = String(req.query.category || "");
  if (!periodStart || !periodEnd) return res.json({ rows: [], period: null });
  const catClause = categoryWhere(category, "loan_account_no");

  const core = db.prepare(`
    SELECT
      COALESCE(NULLIF(product_name,''),'(unspecified)') AS product,
      COUNT(DISTINCT loan_account_no) AS accounts,
      COUNT(DISTINCT branch_name) AS branches,
      SUM(principal_outstanding_end) AS principal_outstanding,
      SUM(principal_demand + interest_demand) AS demand,
      SUM(principal_collected + interest_collected) AS collected,
      SUM(principal_overdue) AS principal_overdue,
      SUM(interest_overdue) AS interest_overdue,
      SUM(principal_outstanding_start - principal_outstanding_end) AS principal_reduced
    FROM od_client_period
    WHERE period_start = ? AND period_end = ?${catClause}
    GROUP BY product
  `).all(periodStart, periodEnd);

  // Receipts by product for the period
  const receipts = db.prepare(`
    SELECT
      COALESCE(NULLIF(product,''),'(unspecified)') AS product,
      COUNT(*) AS receipts,
      SUM(amount) AS posted_amount,
      SUM(CASE WHEN UPPER(mode)='CASH' THEN amount ELSE 0 END) AS cash_amount,
      SUM(CASE WHEN UPPER(mode) IN ('UPI','DIGITAL','ONLINE') THEN amount ELSE 0 END) AS upi_amount,
      SUM(CASE WHEN UPPER(mode) IN ('CHEQUE','DD') THEN amount ELSE 0 END) AS cheque_amount
    FROM od_collections
    WHERE payment_date >= ? AND payment_date <= ?${catClause}
    GROUP BY product
  `).all(periodStart, periodEnd);
  const rByProduct = new Map(receipts.map(r => [r.product, r]));

  // NPA counts from the latest overdue snapshot.
  const snap = latestOverdueSnapshot();
  const npaRows = snap ? db.prepare(`
    SELECT
      COALESCE(NULLIF(product,''),'(unspecified)') AS product,
      SUM(CASE WHEN first_npa_date IS NOT NULL AND first_npa_date <> '' THEN 1 ELSE 0 END) AS npa_accounts,
      SUM(CASE WHEN dpd_classification IN ('DPD-91-180','DPD-180+','SMA2','NPA') THEN 1 ELSE 0 END) AS severe_accounts
    FROM od_overdue
    WHERE snapshot_date = ?${catClause}
    GROUP BY product
  `).all(snap) : [];
  const nByProduct = new Map(npaRows.map(r => [r.product, r]));

  const rows = core.map(c => {
    const r = rByProduct.get(c.product) || {};
    const n = nByProduct.get(c.product) || {};
    const cePct = c.demand > 0 ? (c.collected / c.demand) * 100 : null;
    const cashPct = r.posted_amount > 0 ? (r.cash_amount / r.posted_amount) * 100 : null;
    return {
      product: c.product,
      accounts: c.accounts || 0,
      branches: c.branches || 0,
      principal_outstanding: c.principal_outstanding || 0,
      demand: c.demand || 0,
      collected: c.collected || 0,
      cePct,
      principal_overdue: c.principal_overdue || 0,
      interest_overdue: c.interest_overdue || 0,
      principal_reduced: c.principal_reduced || 0,
      receipts: r.receipts || 0,
      posted_amount: r.posted_amount || 0,
      cash_amount: r.cash_amount || 0,
      upi_amount: r.upi_amount || 0,
      cheque_amount: r.cheque_amount || 0,
      cashPct,
      npa_accounts: n.npa_accounts || 0,
      severe_accounts: n.severe_accounts || 0,
    };
  }).sort((a, b) => b.principal_outstanding - a.principal_outstanding);

  res.json({ rows, period: { periodStart, periodEnd }, snapshotDate: snap });
});

// GET /api/od/analytics/collections-by-product?from=&to=
//   Slice of receipts by product with mode mix and daily trend.
app.get("/api/od/analytics/collections-by-product", (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const category = String(req.query.category || "");
  const where = [];
  const args = [];
  if (from) { where.push("payment_date >= ?"); args.push(from); }
  if (to)   { where.push("payment_date <= ?"); args.push(to); }
  const catClause = categoryWhere(category, "loan_account_no");
  const whereSql = (where.length ? "WHERE " + where.join(" AND ") : "WHERE 1=1") + catClause;

  const rows = db.prepare(`
    SELECT
      COALESCE(NULLIF(product,''),'(unspecified)') AS product,
      COUNT(*) AS receipts,
      SUM(amount) AS total,
      COUNT(DISTINCT loan_account_no) AS accounts,
      COUNT(DISTINCT branch_name) AS branches,
      SUM(CASE WHEN UPPER(mode)='CASH' THEN amount ELSE 0 END) AS cash,
      SUM(CASE WHEN UPPER(mode) IN ('UPI','DIGITAL','ONLINE') THEN amount ELSE 0 END) AS upi,
      SUM(CASE WHEN UPPER(mode) IN ('CHEQUE','DD') THEN amount ELSE 0 END) AS cheque,
      AVG(amount) AS avg_receipt
    FROM od_collections
    ${whereSql}
    GROUP BY product
    ORDER BY total DESC
  `).all(...args).map(r => ({
    ...r,
    cashPct: r.total > 0 ? (r.cash / r.total) * 100 : null,
    digitalPct: r.total > 0 ? (r.upi / r.total) * 100 : null,
  }));

  const byDay = db.prepare(`
    SELECT payment_date AS day,
      COALESCE(NULLIF(product,''),'(unspecified)') AS product,
      SUM(amount) AS total,
      COUNT(*) AS receipts
    FROM od_collections
    ${whereSql}
    GROUP BY day, product
    ORDER BY day
  `).all(...args);

  res.json({ rows, byDay, from, to });
});

// GET /api/od/analytics/branch-product-matrix?periodStart=&periodEnd=
//   Branch × Product heatmap (CE% per intersection).
app.get("/api/od/analytics/branch-product-matrix", (req, res) => {
  const { periodStart, periodEnd } = resolvePeriod(req);
  const category = String(req.query.category || "");
  if (!periodStart || !periodEnd) return res.json({ branches: [], products: [], matrix: [], period: null });

  const rows = db.prepare(`
    SELECT
      COALESCE(NULLIF(branch_name,''),'(unspecified)') AS branch,
      COALESCE(NULLIF(product_name,''),'(unspecified)') AS product,
      COUNT(DISTINCT loan_account_no) AS accounts,
      SUM(principal_outstanding_end) AS principal_outstanding,
      SUM(principal_demand + interest_demand) AS demand,
      SUM(principal_collected + interest_collected) AS collected,
      SUM(principal_overdue + interest_overdue) AS total_overdue
    FROM od_client_period
    WHERE period_start = ? AND period_end = ?${categoryWhere(category, "loan_account_no")}
    GROUP BY branch, product
    HAVING demand > 0 OR collected > 0 OR principal_outstanding > 0
  `).all(periodStart, periodEnd).map(r => ({
    ...r,
    cePct: r.demand > 0 ? (r.collected / r.demand) * 100 : null,
  }));

  const branchTotals = new Map();
  const productTotals = new Map();
  for (const r of rows) {
    const b = branchTotals.get(r.branch) || { branch: r.branch, principal_outstanding: 0, demand: 0, collected: 0 };
    b.principal_outstanding += r.principal_outstanding || 0;
    b.demand += r.demand || 0;
    b.collected += r.collected || 0;
    branchTotals.set(r.branch, b);

    const p = productTotals.get(r.product) || { product: r.product, principal_outstanding: 0, demand: 0, collected: 0 };
    p.principal_outstanding += r.principal_outstanding || 0;
    p.demand += r.demand || 0;
    p.collected += r.collected || 0;
    productTotals.set(r.product, p);
  }
  const branches = Array.from(branchTotals.values())
    .sort((a, b) => b.principal_outstanding - a.principal_outstanding)
    .map(x => ({ ...x, cePct: x.demand > 0 ? (x.collected / x.demand) * 100 : null }));
  const products = Array.from(productTotals.values())
    .sort((a, b) => b.principal_outstanding - a.principal_outstanding)
    .map(x => ({ ...x, cePct: x.demand > 0 ? (x.collected / x.demand) * 100 : null }));

  res.json({ branches, products, matrix: rows, period: { periodStart, periodEnd } });
});

// GET /api/od/drilldown?branch=&product=&bucket=&periodStart=&periodEnd=&from=&to=&limit=
//   Unified drilldown for any slice.
//   bucket: one of DPD classifications (optional) to filter via od_overdue.
//   Returns: { summary, customers[], trend[], receipts[], filters }
app.get("/api/od/drilldown", (req, res) => {
  const branch = (req.query.branch || "").trim();
  const product = (req.query.product || "").trim();
  const bucket = (req.query.bucket || "").trim();
  const mode = (req.query.mode || "").trim().toUpperCase(); // CASH, UPI, CHEQUE, etc.
  const npaOnly = req.query.npaOnly === "1" || req.query.npaOnly === "true";
  const deathOnly = req.query.deathOnly === "1" || req.query.deathOnly === "true";
  const nonContact = req.query.nonContact === "1" || req.query.nonContact === "true";
  const minInstallmentsDue = parseInt(req.query.minInstallmentsDue || "0", 10);
  const minMonthsStranded = parseInt(req.query.minMonthsStranded || "0", 10);
  const category = String(req.query.category || "");
  const limit = Math.min(parseInt(req.query.limit || "500", 10), 2000);
  const { periodStart, periodEnd } = resolvePeriod(req);
  const from = req.query.from || periodStart;
  const to = req.query.to || periodEnd;
  const snap = latestOverdueSnapshot();
  const catClause = categoryWhere(category, "loan_account_no");

  // ── Build WHEREs per source table ──
  const cpWhere = ["period_start = ?", "period_end = ?"];
  const cpArgs = [periodStart, periodEnd];
  if (branch)  { cpWhere.push("COALESCE(NULLIF(branch_name,''),'(unspecified)') = ?"); cpArgs.push(branch); }
  if (product) { cpWhere.push("COALESCE(NULLIF(product_name,''),'(unspecified)') = ?"); cpArgs.push(product); }
  const cpWhereSql = "WHERE " + cpWhere.join(" AND ") + catClause;

  const rWhere = [];
  const rArgs = [];
  if (from) { rWhere.push("payment_date >= ?"); rArgs.push(from); }
  if (to)   { rWhere.push("payment_date <= ?"); rArgs.push(to); }
  if (branch)  { rWhere.push("COALESCE(NULLIF(branch_name,''),'(unspecified)') = ?"); rArgs.push(branch); }
  if (product) { rWhere.push("COALESCE(NULLIF(product,''),'(unspecified)') = ?"); rArgs.push(product); }
  if (mode) {
    if (mode === "UPI") rWhere.push("UPPER(mode) IN ('UPI','DIGITAL','ONLINE')");
    else if (mode === "CHEQUE") rWhere.push("UPPER(mode) IN ('CHEQUE','DD')");
    else { rWhere.push("UPPER(mode) = ?"); rArgs.push(mode); }
  }
  const rWhereSql = (rWhere.length ? "WHERE " + rWhere.join(" AND ") : "WHERE 1=1") + catClause;

  // ── od_overdue filter (bucket / NPA / death / installments / months stranded) ──
  // When any overdue-report filter is given we pull the matching loan list from
  // od_overdue and intersect with the customer list from client_period.
  //
  // Bucket-name normalization: the dpd-buckets chart labels its slices using
  // overdue-days ranges ('0-Current', '1-30', '31-60', '61-90', '91-180',
  // '180+', or the prefixed 'DPD-…' variants), but od_overdue.dpd_classification
  // stores RBI-style labels ('Current', 'SMA-0', 'SMA-1', 'SMA-2', 'NPA').
  // Map between the two so a click on the DPD chart actually populates the
  // drill-down customer list.
  const BUCKET_TO_CLASS = {
    "0-Current": ["Current"], "DPD-0": ["Current"], "DPD-0-Current": ["Current"], "Current": ["Current"],
    "1-30":      ["SMA-0"],   "DPD-1-30":  ["SMA-0"], "SMA-0":   ["SMA-0"],
    "31-60":     ["SMA-1"],   "DPD-31-60": ["SMA-1"], "SMA-1":   ["SMA-1"],
    "61-90":     ["SMA-2"],   "DPD-61-90": ["SMA-2"], "SMA-2":   ["SMA-2"],
    "91-180":    ["NPA"],     "DPD-91-180":["NPA"],   "NPA":     ["NPA"],
    "180+":      ["NPA"],     "DPD-180+":  ["NPA"],
  };
  let bucketAccounts = null;
  const useOvFilter = (bucket || npaOnly || deathOnly || minInstallmentsDue > 0 || minMonthsStranded > 0);
  if (useOvFilter && snap) {
    const ovWhere = ["snapshot_date = ?"];
    const ovArgs = [snap];
    if (bucket) {
      // Map "DPD-91-180" → ["NPA"], etc. Unknown buckets fall through to a
      // literal classification match so legacy callers still work.
      const classes = BUCKET_TO_CLASS[bucket] || [bucket];
      const placeholders = classes.map(() => "?").join(",");
      ovWhere.push(`dpd_classification IN (${placeholders})`);
      ovArgs.push(...classes);
    }
    if (npaOnly)     { ovWhere.push("first_npa_date IS NOT NULL AND first_npa_date <> ''"); }
    if (deathOnly)   { ovWhere.push("(death_flagged_date IS NOT NULL AND death_flagged_date <> '' OR COALESCE(death_case_remark,'') <> '')"); }
    if (minInstallmentsDue > 0) { ovWhere.push("installments_due >= ?"); ovArgs.push(minInstallmentsDue); }
    if (minMonthsStranded > 0 && snap) {
      // approx: snap - first_npa_date in months
      ovWhere.push("first_npa_date IS NOT NULL AND first_npa_date <> '' AND (julianday(?) - julianday(first_npa_date)) / 30.44 >= ?");
      ovArgs.push(snap, minMonthsStranded);
    }
    if (branch)  { ovWhere.push("COALESCE(NULLIF(branch_name,''),'(unspecified)') = ?"); ovArgs.push(branch); }
    if (product) { ovWhere.push("COALESCE(NULLIF(product,''),'(unspecified)') = ?"); ovArgs.push(product); }
    const ovRows = db.prepare(
      `SELECT loan_account_no FROM od_overdue WHERE ${ovWhere.join(" AND ")}${catClause}`
    ).all(...ovArgs);
    bucketAccounts = new Set(ovRows.map(r => r.loan_account_no));
  }

  // ── Summary from client-period ──
  let summary = { accounts: 0, principal_outstanding: 0, demand: 0, collected: 0, cePct: null, principal_overdue: 0, interest_overdue: 0, receipts: 0, posted_amount: 0, cash_amount: 0, upi_amount: 0 };
  if (periodStart && periodEnd) {
    const s = db.prepare(`
      SELECT COUNT(*) AS accounts,
        SUM(principal_outstanding_end) AS principal_outstanding,
        SUM(principal_demand + interest_demand) AS demand,
        SUM(principal_collected + interest_collected) AS collected,
        SUM(principal_overdue) AS principal_overdue,
        SUM(interest_overdue) AS interest_overdue
      FROM od_client_period
      ${cpWhereSql}
    `).get(...cpArgs);
    if (s) {
      summary.accounts = s.accounts || 0;
      summary.principal_outstanding = s.principal_outstanding || 0;
      summary.demand = s.demand || 0;
      summary.collected = s.collected || 0;
      summary.principal_overdue = s.principal_overdue || 0;
      summary.interest_overdue = s.interest_overdue || 0;
      summary.cePct = s.demand > 0 ? (s.collected / s.demand) * 100 : null;
    }
  }
  const r = db.prepare(`
    SELECT COUNT(*) AS receipts,
      SUM(amount) AS posted_amount,
      SUM(CASE WHEN UPPER(mode)='CASH' THEN amount ELSE 0 END) AS cash_amount,
      SUM(CASE WHEN UPPER(mode) IN ('UPI','DIGITAL','ONLINE') THEN amount ELSE 0 END) AS upi_amount
    FROM od_collections
    ${rWhereSql}
  `).get(...rArgs);
  if (r) {
    summary.receipts = r.receipts || 0;
    summary.posted_amount = r.posted_amount || 0;
    summary.cash_amount = r.cash_amount || 0;
    summary.upi_amount = r.upi_amount || 0;
  }

  // ── Customer list from client-period (richer than od_overdue) ──
  let customers = [];
  if (periodStart && periodEnd) {
    customers = db.prepare(`
      SELECT
        loan_account_no, customer_name, customer_number,
        branch_name, officer_name, officer_code, product_name,
        principal_outstanding_end AS principal_outstanding,
        principal_overdue, interest_overdue,
        (principal_overdue + interest_overdue) AS total_overdue,
        principal_demand, principal_collected, interest_demand, interest_collected,
        (principal_demand + interest_demand) AS demand,
        (principal_collected + interest_collected) AS collected,
        last_principal_collected_date, last_interest_collected_date,
        funder_name, account_status, disbursement_date
      FROM od_client_period
      ${cpWhereSql}
      ORDER BY (principal_overdue + interest_overdue) DESC, principal_outstanding_end DESC
      LIMIT ?
    `).all(...cpArgs, limit).map(c => ({
      ...c,
      cePct: c.demand > 0 ? (c.collected / c.demand) * 100 : null,
    }));
    if (bucketAccounts) customers = customers.filter(c => bucketAccounts.has(c.loan_account_no));
  }

  // Enrich with phone numbers from customers master
  if (customers.length > 0) {
    const loans = customers.map(c => c.loan_account_no);
    const placeholders = loans.map(() => "?").join(",");
    const phoneRows = db.prepare(
      `SELECT loan_account_no, mobile_number, residence_phone FROM customers WHERE loan_account_no IN (${placeholders})`
    ).all(...loans);
    const pMap = new Map(phoneRows.map(p => [p.loan_account_no, p]));
    customers = customers.map(c => ({
      ...c,
      mobile_number: pMap.get(c.loan_account_no)?.mobile_number || null,
      residence_phone: pMap.get(c.loan_account_no)?.residence_phone || null,
    }));
    // Non-contactable: keep only customers with no phone on file
    if (nonContact) {
      customers = customers.filter(c => !c.mobile_number && !c.residence_phone);
    }
  }

  // ── Daily trend for receipts in range ──
  const trend = db.prepare(`
    SELECT payment_date AS day,
      SUM(amount) AS total,
      SUM(CASE WHEN UPPER(mode)='CASH' THEN amount ELSE 0 END) AS cash,
      SUM(CASE WHEN UPPER(mode) IN ('UPI','DIGITAL','ONLINE') THEN amount ELSE 0 END) AS upi,
      COUNT(*) AS receipts
    FROM od_collections
    ${rWhereSql}
    GROUP BY day
    ORDER BY day
  `).all(...rArgs);

  // ── Recent receipts (latest 100) ──
  const receipts = db.prepare(`
    SELECT receipt_no, loan_account_no, customer_name, branch_name, product,
           amount, mode, payment_date, payment_officer_name, paid_by
    FROM od_collections
    ${rWhereSql}
    ORDER BY payment_date DESC
    LIMIT 100
  `).all(...rArgs);

  res.json({
    summary,
    customers,
    trend,
    receipts,
    filters: { branch: branch || null, product: product || null, bucket: bucket || null, periodStart, periodEnd, from, to },
    snapshotDate: snap,
  });
});

// GET /api/od/upload-history
app.get("/api/od/upload-history", (req, res) => {
  const uploads = db.prepare(`SELECT * FROM upload_log ORDER BY uploaded_at DESC LIMIT 50`).all();
  const latestPool = db.prepare(`SELECT snapshot_date, COUNT(*) AS rows FROM pool_snapshots
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM pool_snapshots)`).get();
  const latestAccrued = db.prepare(`SELECT snapshot_date, COUNT(*) AS rows FROM accrued_snapshots
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM accrued_snapshots)`).get();
  const latestOverdue = db.prepare(`SELECT snapshot_date, COUNT(*) AS rows FROM od_overdue
    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM od_overdue)`).get();
  const latestClientPeriod = db.prepare(`SELECT period_start, period_end, COUNT(*) AS rows FROM od_client_period
    WHERE (period_start, period_end) = (SELECT period_start, period_end FROM od_client_period ORDER BY period_end DESC LIMIT 1)`).get();
  const totalCustomers = db.prepare(`SELECT COUNT(*) AS n FROM customers`).get().n;
  const totalCollections = db.prepare(`SELECT COUNT(*) AS n, SUM(amount) AS total FROM od_collections`).get();
  res.json({
    uploads, latestPool, latestAccrued, latestOverdue, latestClientPeriod,
    totalCustomers, totalCollections, retentionDays: RETENTION_DAYS,
  });
});

// ─── Disbursement Analytics ────────────────────────────────────────────────
// GET /api/od/disbursements?from=&to=&branch=&product=&category=
//
// Aggregates loan disbursements from the customers master, joined with the
// latest pool/foreclosure snapshots to derive Active/Closed status. Returns
// summary KPIs, branch-/product-/category-level totals, monthly trend, and
// the most-recent N disbursements as a table feed.
//
// Filters:
//   from, to    — ISO YYYY-MM-DD inclusive range on disbursement_date
//   branch      — exact match (case-insensitive)
//   product     — exact match (case-insensitive)
//   category    — 'group' | 'individual' (matches loan_category)
//
// Notes:
//   * disbursement_date is stored as a raw string from Finflux — we accept
//     both ISO ("YYYY-MM-DD...") and DD-MMM-YYYY ("26-Apr-2022") shapes.
//   * Read-only endpoint — no DB writes.
app.get("/api/od/disbursements", (req, res) => {
  try {
    const from = String(req.query.from || "").trim();        // YYYY-MM-DD
    const to = String(req.query.to || "").trim();            // YYYY-MM-DD
    const branch = String(req.query.branch || "").trim().toLowerCase();
    const product = String(req.query.product || "").trim().toLowerCase();
    const category = String(req.query.category || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim().toLowerCase(); // '' | active | closed | pending
    const limit = Math.min(50000, Math.max(100, parseInt(req.query.limit || "10000", 10)));

    const MONTHS = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
                     jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    function parseDate(s) {
      if (!s) return null;
      const t = String(s).trim();
      if (!t) return null;
      // ISO YYYY-MM-DD or YYYY/MM/DD prefix
      const iso = t.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
      // DD-MMM-YYYY (e.g. "26-Apr-2022", "1-Jan-1970")
      const dmy = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
      if (dmy) {
        const mm = MONTHS[dmy[2].toLowerCase()];
        if (mm) return `${dmy[3]}-${mm}-${String(dmy[1]).padStart(2, "0")}`;
      }
      // DD/MM/YYYY
      const dmy2 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dmy2) {
        return `${dmy2[3]}-${String(dmy2[2]).padStart(2,"0")}-${String(dmy2[1]).padStart(2,"0")}`;
      }
      return null;
    }

    // Pull the raw rows once, then aggregate in JS. With ~85k customer rows
    // this runs in <100 ms.
    const rows = db.prepare(`
      SELECT
        c.loan_account_no, c.customer_number, c.customer_name,
        c.branch, c.product_name, c.loan_category,
        c.disbursement_date, c.loan_amount,
        EXISTS(SELECT 1 FROM foreclosure_snapshots f WHERE f.loan_account_no = c.loan_account_no) AS is_closed,
        EXISTS(SELECT 1 FROM pool_snapshots p WHERE p.loan_account_no = c.loan_account_no) AS is_active
      FROM customers c
      WHERE COALESCE(c.disbursement_date, '') <> ''
    `).all();

    // Aggregators
    const branchAgg = new Map();    // key: branch
    const productAgg = new Map();   // key: product_name
    const categoryAgg = new Map();  // key: 'Group Loan' | 'Individual Loan' | 'Unknown'
    const monthAgg = new Map();     // key: 'YYYY-MM'
    let totalCount = 0;
    let totalAmount = 0;
    const customerSet = new Set();
    let activeCount = 0;
    let closedCount = 0;
    let pendingCount = 0;
    const recent = []; // most recent disbursements for the table view

    function bump(map, k, amount) {
      if (!k) k = "(unspecified)";
      const cur = map.get(k) || { key: k, count: 0, total: 0 };
      cur.count += 1;
      cur.total += amount;
      map.set(k, cur);
    }

    for (const r of rows) {
      // Date filter
      const iso = parseDate(r.disbursement_date);
      if (!iso) continue;
      if (from && iso < from) continue;
      if (to && iso > to) continue;

      // Branch / product filter
      if (branch && (r.branch || "").toLowerCase() !== branch) continue;
      if (product && (r.product_name || "").toLowerCase() !== product) continue;

      // Category filter
      const catRaw = (r.loan_category || "").toUpperCase();
      const isGroup = catRaw.includes("GROUP");
      const isIndividual = catRaw.includes("INDIVIDUAL");
      if (category === "group" && !isGroup) continue;
      if (category === "individual" && !isIndividual) continue;

      const amount = Number(r.loan_amount) || 0;
      const ym = iso.slice(0, 7);
      const catLabel = isGroup ? "Group Loan" : isIndividual ? "Individual Loan" : "Unknown";

      bump(branchAgg, r.branch || "", amount);
      bump(productAgg, r.product_name || "", amount);
      bump(categoryAgg, catLabel, amount);
      bump(monthAgg, ym, amount);

      totalCount += 1;
      totalAmount += amount;
      if (r.customer_number) customerSet.add(r.customer_number);

      // Status (foreclosed-wins)
      const rowStatus = r.is_closed ? "Closed" : r.is_active ? "Active" : "Pending";
      if (r.is_closed) closedCount += 1;
      else if (r.is_active) activeCount += 1;
      else pendingCount += 1;

      // Status filter — applied AFTER counting so summary numbers stay correct.
      if (status === "active" && rowStatus !== "Active") continue;
      if (status === "closed" && rowStatus !== "Closed") continue;
      if (status === "pending" && rowStatus !== "Pending") continue;

      if (recent.length < limit) {
        recent.push({
          loan_account_no: r.loan_account_no,
          customer_number: r.customer_number,
          customer_name: r.customer_name,
          branch: r.branch,
          product_name: r.product_name,
          loan_category: r.loan_category,
          disbursement_date_iso: iso,
          loan_amount: amount,
          status: rowStatus,
        });
      }
    }

    // Sort recent desc by date
    recent.sort((a, b) => (a.disbursement_date_iso < b.disbursement_date_iso ? 1 : -1));

    const avgTicket = totalCount > 0 ? Math.round((totalAmount / totalCount) * 100) / 100 : 0;

    function toSorted(map, opts = {}) {
      const arr = [...map.values()];
      arr.sort((a, b) => b.total - a.total);
      return opts.limit ? arr.slice(0, opts.limit) : arr;
    }

    // byMonth sorted ascending by month key for trend
    const byMonth = [...monthAgg.values()].sort((a, b) => a.key.localeCompare(b.key));

    res.json({
      summary: {
        count: totalCount,
        totalAmount: Math.round(totalAmount * 100) / 100,
        avgTicket,
        customerCount: customerSet.size,
        active: activeCount,
        closed: closedCount,
        pending: pendingCount,
      },
      byBranch: toSorted(branchAgg, { limit: 30 }),
      byProduct: toSorted(productAgg, { limit: 30 }),
      byCategory: [...categoryAgg.values()].sort((a, b) => b.total - a.total),
      byMonth,
      recent,
      filters: { from, to, branch, product, category, status, limit },
    });
  } catch (err) {
    console.error("[disbursements]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/od/retention/run — manual retention trigger (admin)
app.post("/api/od/retention/run", requireUploader, (req, res) => {
  res.json(purgeOldSnapshots(RETENTION_DAYS));
});

// POST /api/od/rollup/run — manual rollup trigger (admin).
// Useful for backfilling after restoring from a backup or to force a fresh
// rollup without waiting for the 2:55 AM cron.
app.post("/api/od/rollup/run", requireUploader, (req, res) => {
  try {
    const result = rollupMonthlySnapshots({ trigger: "manual" });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[ROLLUP] manual run failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/od/rollup/status — last N rollup runs + current rollup table sizes.
// Lets the UI show "historical data goes back to YYYY-MM".
app.get("/api/od/rollup/status", (req, res) => {
  const recent = db.prepare(
    `SELECT * FROM rollup_log ORDER BY run_at DESC LIMIT 20`
  ).all();
  const rowCount = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const minMax = (t) => db.prepare(
    `SELECT MIN(year_month) AS min_ym, MAX(year_month) AS max_ym FROM ${t}`
  ).get();
  res.json({
    recent,
    tables: {
      pool_monthly_account:    { rows: rowCount("pool_monthly_account"),    ...minMax("pool_monthly_account") },
      pool_monthly_agg:        { rows: rowCount("pool_monthly_agg"),        ...minMax("pool_monthly_agg") },
      overdue_monthly_account: { rows: rowCount("overdue_monthly_account"), ...minMax("overdue_monthly_account") },
      overdue_monthly_agg:     { rows: rowCount("overdue_monthly_agg"),     ...minMax("overdue_monthly_agg") },
      accrued_monthly_account: { rows: rowCount("accrued_monthly_account"), ...minMax("accrued_monthly_account") },
    },
  });
});

// GET /api/od/analytics/monthly-history?from=YYYY-MM&to=YYYY-MM&branch=
// Long-horizon trend: per-month principal outstanding, overdue, and DPD-bucket
// split — served entirely from pool_monthly_agg so it works for any month,
// including months older than 90 days where daily snapshots are already gone.
app.get("/api/od/analytics/monthly-history", (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  const branch = String(req.query.branch || "");
  const category = String(req.query.category || "");

  // When no category filter: use the pre-aggregated pool_monthly_agg for speed.
  // When category is set: aggregate on-the-fly from pool_monthly_account (which
  // carries loan_account_no so it can be joined/filtered by customers.loan_category).
  const useAcct = !!category;
  const tbl = useAcct ? "pool_monthly_account" : "pool_monthly_agg";

  let where = "1=1";
  const params = [];
  if (from)   { where += " AND year_month >= ?"; params.push(from); }
  if (to)     { where += " AND year_month <= ?"; params.push(to); }
  if (branch) { where += " AND branch = ?";      params.push(branch); }
  if (useAcct) where += categoryWhere(category, "loan_account_no");

  if (useAcct) {
    // Derive a dpd_bucket expression from account_dpd_classification so we can
    // produce the same bucket split the pre-aggregated table provides.
    const bucketExpr = `CASE
        WHEN overdue_days <= 0 THEN '0-Current'
        WHEN overdue_days BETWEEN 1 AND 30 THEN '1-30'
        WHEN overdue_days BETWEEN 31 AND 60 THEN '31-60'
        WHEN overdue_days BETWEEN 61 AND 90 THEN '61-90'
        WHEN overdue_days BETWEEN 91 AND 180 THEN '91-180'
        ELSE '180+'
      END`;

    const totals = db.prepare(`
      SELECT year_month,
             COUNT(*)                   AS accounts,
             SUM(principal_outstanding) AS principal_outstanding,
             SUM(interest_outstanding)  AS interest_outstanding,
             SUM(principal_overdue)     AS principal_overdue,
             SUM(interest_overdue)      AS interest_overdue,
             SUM(current_od)            AS current_od
        FROM ${tbl} WHERE ${where}
       GROUP BY year_month ORDER BY year_month
    `).all(...params);

    const buckets = db.prepare(`
      SELECT year_month, ${bucketExpr} AS dpd_bucket,
             COUNT(*)                   AS accounts,
             SUM(principal_outstanding) AS principal_outstanding,
             SUM(principal_overdue)     AS principal_overdue
        FROM ${tbl} WHERE ${where}
       GROUP BY year_month, dpd_bucket
       ORDER BY year_month,
                CASE dpd_bucket
                  WHEN '0-Current' THEN 0 WHEN '1-30' THEN 1 WHEN '31-60' THEN 2
                  WHEN '61-90' THEN 3 WHEN '91-180' THEN 4 ELSE 5 END
    `).all(...params);

    const byBranch = branch ? [] : db.prepare(`
      SELECT year_month, branch,
             COUNT(*)                   AS accounts,
             SUM(principal_outstanding) AS principal_outstanding,
             SUM(principal_overdue)     AS principal_overdue
        FROM ${tbl} WHERE ${where}
       GROUP BY year_month, branch ORDER BY year_month, branch
    `).all(...params);

    return res.json({ filters: { from, to, branch: branch || null, category }, totals, buckets, byBranch });
  }

  // Totals per month (sum across branches and buckets).
  const totals = db.prepare(`
    SELECT year_month,
           SUM(account_count)         AS accounts,
           SUM(principal_outstanding) AS principal_outstanding,
           SUM(interest_outstanding)  AS interest_outstanding,
           SUM(principal_overdue)     AS principal_overdue,
           SUM(interest_overdue)      AS interest_overdue,
           SUM(current_od)            AS current_od
      FROM pool_monthly_agg WHERE ${where}
     GROUP BY year_month
     ORDER BY year_month
  `).all(...params);

  // DPD bucket split per month.
  const buckets = db.prepare(`
    SELECT year_month, dpd_bucket,
           SUM(account_count)         AS accounts,
           SUM(principal_outstanding) AS principal_outstanding,
           SUM(principal_overdue)     AS principal_overdue
      FROM pool_monthly_agg WHERE ${where}
     GROUP BY year_month, dpd_bucket
     ORDER BY year_month,
              CASE dpd_bucket
                WHEN '0-Current' THEN 0 WHEN '1-30' THEN 1 WHEN '31-60' THEN 2
                WHEN '61-90' THEN 3 WHEN '91-180' THEN 4 ELSE 5 END
  `).all(...params);

  // Branch split per month (only if no specific branch was filtered).
  const byBranch = branch ? [] : db.prepare(`
    SELECT year_month, branch,
           SUM(account_count)         AS accounts,
           SUM(principal_outstanding) AS principal_outstanding,
           SUM(principal_overdue)     AS principal_overdue
      FROM pool_monthly_agg WHERE ${where}
     GROUP BY year_month, branch
     ORDER BY year_month, branch
  `).all(...params);

  res.json({ filters: { from, to, branch: branch || null }, totals, buckets, byBranch });
});

// GET /api/od/analytics/monthly-account?year_month=YYYY-MM&branch=&dpd=
// Account-level drill-down for a given past month. Answers "show me every
// account that was in the 91-180 bucket in 2025-08" even if that daily snapshot
// was purged 6 months ago.
app.get("/api/od/analytics/monthly-account", (req, res) => {
  const ym = String(req.query.year_month || "");
  if (!ym) return res.status(400).json({ error: "year_month is required (YYYY-MM)" });
  const branch = String(req.query.branch || "");
  const dpd = String(req.query.dpd || "");
  const category = String(req.query.category || "");
  const limit = Math.min(Number(req.query.limit) || 500, 5000);

  let where = "year_month = ?";
  const params = [ym];
  if (branch) { where += " AND branch = ?"; params.push(branch); }
  if (dpd)    { where += " AND account_dpd_classification = ?"; params.push(dpd); }
  where += categoryWhere(category, "loan_account_no");

  const rows = db.prepare(`
    SELECT * FROM pool_monthly_account
     WHERE ${where}
     ORDER BY principal_overdue DESC
     LIMIT ?
  `).all(...params, limit);

  res.json({ year_month: ym, branch: branch || null, dpd: dpd || null, count: rows.length, rows });
});

// ── Pool Data (SQLite) helpers & routes ──────────────────────────────────────

// POOL_JOIN — one row per loan_account_no (no duplicates from multi-snapshot history).
// Picks the LATEST pool snapshot AND the latest foreclosure snapshot per loan via
// correlated subqueries on (loan_account_no, MAX(snapshot_date)). Adds foreclosure
// fields so callers can apply the foreclosed-wins rule (closed > active).
const POOL_JOIN = `
  SELECT
    c.loan_account_no, c.customer_number, c.customer_name, c.branch,
    c.center_name, c.group_name, c.mobile_number, c.aadhaar_number,
    c.product_interest_rate, c.loan_amount, c.officer_name,
    c.disbursement_date, c.last_payment_date,
    p.snapshot_date, p.principal_outstanding, p.interest_outstanding,
    p.principal_overdue, p.interest_overdue, p.current_od,
    p.overdue_days, p.loan_status, p.account_dpd_classification,
    p.customer_dpd, p.customer_dpd_classification, p.total_interest_collected,
    f.snapshot_date            AS fc_snapshot_date,
    f.closed_date              AS fc_closed_date,
    f.closure_reason           AS fc_closure_reason,
    f.closure_type             AS fc_closure_type,
    f.closing_principal        AS fc_closing_principal,
    f.total_interest_collected AS fc_total_interest_collected,
    f.interest_collected       AS fc_interest_collected,
    f.penalty_collected        AS fc_penalty_collected,
    f.maturity_date            AS fc_maturity_date
  FROM customers c
  LEFT JOIN pool_snapshots p
    ON p.loan_account_no = c.loan_account_no
   AND p.snapshot_date = (
     SELECT MAX(snapshot_date) FROM pool_snapshots
     WHERE loan_account_no = c.loan_account_no
   )
  LEFT JOIN foreclosure_snapshots f
    ON f.loan_account_no = c.loan_account_no
   AND f.snapshot_date = (
     SELECT MAX(snapshot_date) FROM foreclosure_snapshots
     WHERE loan_account_no = c.loan_account_no
   )
`;

function mapPoolRow(r) {
  // Foreclosed-wins rule: if a foreclosure snapshot exists for this loan, the
  // loan is Closed regardless of whatever pool says.
  const isClosed = !!r.fc_snapshot_date;
  return {
    loanNumber:             r.loan_account_no || "",
    customerNumber:         r.customer_number || "",
    memberName:             r.customer_name || "",
    officeName:             r.branch || "",
    centerName:             r.center_name || "",
    groupName:              r.group_name || "",
    phone:                  String(r.mobile_number || "").replace(/\D/g, ""),
    aadhaar:                String(r.aadhaar_number || "").replace(/\D/g, ""),
    interestRate:           Number(r.product_interest_rate) || 0,
    loanAmount:             Number(r.loan_amount) || 0,
    principalOutstanding:   isClosed ? 0 : (Number(r.principal_outstanding) || 0),
    interestOutstanding:    isClosed ? 0 : (Number(r.interest_outstanding) || 0),
    principalOverdue:       isClosed ? 0 : (Number(r.principal_overdue) || 0),
    interestOverdue:        isClosed ? 0 : (Number(r.interest_overdue) || 0),
    currentOD:              isClosed ? 0 : (Number(r.current_od) || 0),
    overdueDays:            isClosed ? 0 : (Number(r.overdue_days) || 0),
    // Authoritative status — Closed wins over pool's loan_status.
    loanStatus:             isClosed ? "Closed" : (r.loan_status || ""),
    isClosed,
    accountDPD:             isClosed ? "" : (r.account_dpd_classification || ""),
    customerDPD:            isClosed ? 0 : (Number(r.customer_dpd) || 0),
    customerDPDClass:       isClosed ? "" : (r.customer_dpd_classification || ""),
    totalInterestCollected: Number(r.total_interest_collected) || 0,
    reportDate:             r.snapshot_date || "",
    // Closure metadata (empty/zero for active loans).
    closedDate:             r.fc_closed_date || "",
    closureType:            r.fc_closure_type || "",
    closureReason:          r.fc_closure_reason || "",
    closingPrincipal:       Number(r.fc_closing_principal) || 0,
    totalInterestCollectedFc: Number(r.fc_total_interest_collected) || 0,
    interestCollectedFc:    Number(r.fc_interest_collected) || 0,
    penaltyCollectedFc:     Number(r.fc_penalty_collected) || 0,
    maturityDate:           r.fc_maturity_date || "",
  };
}

function calcInterestTillDate(record) {
  const reportDate = new Date(record.reportDate + "T00:00:00");
  const today = new Date(); today.setHours(0,0,0,0);
  const daysSinceReport = Math.max(0, Math.floor((today - reportDate) / 86400000));
  const dailyRate = record.interestRate / 100 / 365;
  const additionalInterest = record.principalOverdue * dailyRate * daysSinceReport;
  const interestOverdueTillDate = Math.round((record.interestOverdue + additionalInterest) * 100) / 100;
  return {
    ...record, daysSinceReport,
    additionalInterest:    Math.round(additionalInterest * 100) / 100,
    interestOverdueTillDate,
    arrearAmount:          Math.round((record.principalOverdue + record.interestOverdue) * 100) / 100,
    arrearAmountTillDate:  Math.round((record.principalOverdue + interestOverdueTillDate) * 100) / 100,
  };
}

function poolAggregates(members) {
  const CLOSED_S   = ["Closed", "Written Off"];
  const DELINQ_DPD = ["SMA-0", "SMA-1", "SMA-2", "NPA"];
  const closedCount     = members.filter(r => CLOSED_S.includes(r.loanStatus)).length;
  const delinquentCount = members.filter(r => !CLOSED_S.includes(r.loanStatus) && DELINQ_DPD.includes(r.customerDPDClass)).length;
  const activeCount     = members.filter(r => !CLOSED_S.includes(r.loanStatus) && !DELINQ_DPD.includes(r.customerDPDClass)).length;
  const nonClosed       = members.filter(r => !CLOSED_S.includes(r.loanStatus));
  const totalPrincipalOverdue = members.reduce((s, r) => s + r.principalOverdue, 0);
  const totalInterestOverdue  = members.reduce((s, r) => s + r.interestOverdueTillDate, 0);
  const totalArrear           = members.reduce((s, r) => s + r.arrearAmountTillDate, 0);

  // ── Group OD calculation (computed only — never written back) ──────────
  // Total default due = sum of arrears of SMA/NPA defaulters.
  // Per-member share = totalDefaultDue ÷ TOTAL group size (all members).
  // This is a calculated/display value; it is not persisted to the DB.
  // Eligibility to actually pay (i.e. clickable in UI) is restricted to
  // closed members; other members see the share but cannot record it.
  const defaulterMembers = members.filter(r =>
    !CLOSED_S.includes(r.loanStatus) && DELINQ_DPD.includes(r.customerDPDClass)
  );
  const totalDefaultDue = defaulterMembers.reduce((s, r) => s + (r.arrearAmountTillDate || 0), 0);
  // Edge case: empty group → 0. Otherwise divide by total member count.
  const perGroupMemberShare = members.length > 0
    ? Math.round((totalDefaultDue / members.length) * 100) / 100
    : 0;

  return {
    count: members.length, activeCount, delinquentCount, closedCount,
    nonClosedCount: nonClosed.length,
    totalPrincipalOverdue: Math.round(totalPrincipalOverdue * 100) / 100,
    totalInterestOverdue:  Math.round(totalInterestOverdue  * 100) / 100,
    totalArrear:           Math.round(totalArrear           * 100) / 100,
    perMemberArrear: nonClosed.length > 0 ? Math.round(totalArrear / nonClosed.length * 100) / 100 : 0,
    // Group OD aggregates — computed, never persisted.
    totalDefaultDue:       Math.round(totalDefaultDue * 100) / 100,
    defaulterCount:        defaulterMembers.length,
    perGroupMemberShare,
  };
}

// GET /api/pool/lookup?loan=|?phone=|?aadhaar=
app.get("/api/pool/lookup", (req, res) => {
  try {
    const { loan, phone, aadhaar } = req.query;
    let rows = [];
    if (loan) {
      rows = db.prepare(POOL_JOIN + " WHERE c.loan_account_no = ?").all(String(loan).trim());
    } else if (phone) {
      const key = String(phone).replace(/\D/g, "");
      rows = db.prepare(POOL_JOIN + " WHERE REPLACE(REPLACE(c.mobile_number,' ',''),'-','') LIKE ?").all("%" + key + "%");
    } else if (aadhaar) {
      const key = String(aadhaar).replace(/\D/g, "");
      rows = db.prepare(POOL_JOIN + " WHERE REPLACE(c.aadhaar_number,' ','') = ?").all(key);
    }
    const results = rows.map(mapPoolRow).map(calcInterestTillDate);
    const reportDate = results[0]?.reportDate || "";
    res.json({ found: results.length > 0, count: results.length, reportDate, results });
  } catch (e) {
    console.error("[pool/lookup]", e.message);
    res.json({ found: false, count: 0, results: [] });
  }
});

// GET /api/pool/center?name=XXXX
app.get("/api/pool/center", (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.json({ found: false, members: [], count: 0 });
    const rows = db.prepare(POOL_JOIN + " WHERE LOWER(c.center_name) = LOWER(?)").all(name.trim());
    const members = rows.map(mapPoolRow).map(calcInterestTillDate);
    const agg = poolAggregates(members);
    const reportDate = members[0]?.reportDate || "";
    res.json({ found: members.length > 0, centerName: name, ...agg, members, reportDate });
  } catch (e) {
    console.error("[pool/center]", e.message);
    res.json({ found: false, members: [], count: 0 });
  }
});

// GET /api/customers/loans?customerId=|loanAccountNo=|phone=|aadhaar=
// Returns ALL ACTIVE loans for a single customer, each with a full OD breakdown
// from the latest pool + accrued snapshots. Skips loans whose loan_status is
// Closed / Written Off / Settled.
app.get("/api/customers/loans", (req, res) => {
  try {
    const { customerId, loanAccountNo, phone, aadhaar } = req.query;
    // Step 1 — resolve the customer_number(s) from any identifier.
    let customerNumbers = [];
    if (customerId) {
      customerNumbers = [String(customerId).trim()];
    } else if (loanAccountNo) {
      const row = db.prepare("SELECT customer_number FROM customers WHERE loan_account_no = ?")
        .get(String(loanAccountNo).trim());
      if (row?.customer_number) customerNumbers = [row.customer_number];
    } else if (phone) {
      const key = String(phone).replace(/\D/g, "");
      const rows = db.prepare(
        "SELECT DISTINCT customer_number FROM customers WHERE REPLACE(REPLACE(REPLACE(mobile_number,' ',''),'-',''),'+','') LIKE ?"
      ).all("%" + key + "%");
      customerNumbers = rows.map(r => r.customer_number).filter(Boolean);
    } else if (aadhaar) {
      const key = String(aadhaar).replace(/\D/g, "");
      const rows = db.prepare(
        "SELECT DISTINCT customer_number FROM customers WHERE REPLACE(REPLACE(aadhaar_number,' ',''),'-','') = ?"
      ).all(key);
      customerNumbers = rows.map(r => r.customer_number).filter(Boolean);
    }
    if (customerNumbers.length === 0) {
      return res.json({ found: false, customer: null, loans: [] });
    }

    // Step 2 — fetch all loans for these customer_numbers, join with latest
    // pool_snapshots + accrued_snapshots for live OD values, plus the latest
    // foreclosure_snapshot per loan so closed loans are surfaced with closure
    // info rather than dropped.
    const latestPool = db.prepare("SELECT MAX(snapshot_date) AS d FROM pool_snapshots").get()?.d;
    const latestAccrued = db.prepare("SELECT MAX(snapshot_date) AS d FROM accrued_snapshots").get()?.d;
    const placeholders = customerNumbers.map(() => "?").join(",");
    // The foreclosure subquery picks the latest snapshot per loan via a
    // (snapshot_date, loan_account_no) anti-join trick: we join on the latest
    // snapshot_date for each loan_account_no.
    const rows = db.prepare(`
      SELECT
        c.loan_account_no, c.customer_number, c.customer_name, c.branch,
        c.center_name, c.group_name, c.mobile_number, c.aadhaar_number,
        c.product_name, c.product_interest_rate, c.loan_amount,
        c.disbursement_date, c.last_installment_date, c.last_payment_date,
        p.principal_outstanding, p.interest_outstanding,
        p.principal_overdue, p.interest_overdue, p.current_od,
        p.overdue_days, p.customer_dpd, p.loan_status, p.account_dpd_classification,
        a.accrued_interest,
        f.snapshot_date     AS fc_snapshot_date,
        f.closed_date       AS fc_closed_date,
        f.closure_reason    AS fc_closure_reason,
        f.closure_type      AS fc_closure_type,
        f.closing_principal AS fc_closing_principal,
        f.total_interest_collected AS fc_total_interest_collected,
        f.interest_collected       AS fc_interest_collected,
        f.penalty_collected        AS fc_penalty_collected,
        f.maturity_date            AS fc_maturity_date,
        f.center                   AS fc_center,
        f.product_name             AS fc_product_name
      FROM customers c
      LEFT JOIN pool_snapshots p
        ON p.loan_account_no = c.loan_account_no AND p.snapshot_date = ?
      LEFT JOIN accrued_snapshots a
        ON a.loan_account_no = c.loan_account_no AND a.snapshot_date = ?
      LEFT JOIN foreclosure_snapshots f
        ON f.loan_account_no = c.loan_account_no
       AND f.snapshot_date = (
         SELECT MAX(snapshot_date) FROM foreclosure_snapshots
         WHERE loan_account_no = c.loan_account_no
       )
      WHERE c.customer_number IN (${placeholders})
    `).all(latestPool || "", latestAccrued || "", ...customerNumbers);

    const INACTIVE_STATUSES = new Set(["Closed", "Written Off", "Settled", "CLOSED", "WRITTEN OFF", "SETTLED"]);
    const loans = rows
      // Foreclosed-wins: keep loans that have a foreclosure record (we'll
      // surface them as Closed). Drop only legacy pool-marked-closed loans
      // that have NO foreclosure record.
      .filter(r => {
        const poolClosed = INACTIVE_STATUSES.has((r.loan_status || "").trim());
        const isForeclosed = !!r.fc_snapshot_date;
        return !poolClosed || isForeclosed;
      })
      .map(r => {
        const isClosed = !!r.fc_snapshot_date;
        const po = Number(r.principal_outstanding) || 0;
        const ai = Number(r.accrued_interest) || 0;
        const ui = Number(r.interest_overdue) || 0;
        return {
          loanAccountNo: r.loan_account_no || "",
          customerNumber: r.customer_number || "",
          customerName: r.customer_name || "",
          branch: r.branch || "",
          centerName: r.center_name || r.fc_center || "",
          groupName: r.group_name || "",
          productName: r.product_name || r.fc_product_name || "",
          interestRate: Number(r.product_interest_rate) || 0,
          loanAmount: Number(r.loan_amount) || 0,
          disbursementDate: r.disbursement_date || "",
          lastPaymentDate: r.last_payment_date || "",
          principalOutstanding: po,
          interestOutstanding: Number(r.interest_outstanding) || 0,
          principalOverdue: Number(r.principal_overdue) || 0,
          interestOverdue: ui,
          currentOD: Number(r.current_od) || 0,
          overdueDays: Number(r.overdue_days) || 0,
          customerDPD: Number(r.customer_dpd) || 0,
          // Authoritative loan status — Closed wins over pool's loan_status.
          loanStatus: isClosed ? "Closed" : (r.loan_status || ""),
          isClosed,
          dpdClassification: r.account_dpd_classification || "",
          accruedInterest: ai,
          foreclosureValue: po + ui + ai,
          // Closure details (null/empty for active loans).
          closedDate: r.fc_closed_date || "",
          closureReason: r.fc_closure_reason || "",
          closureType: r.fc_closure_type || "",
          closingPrincipal: Number(r.fc_closing_principal) || 0,
          totalInterestCollected: Number(r.fc_total_interest_collected) || 0,
          interestCollected: Number(r.fc_interest_collected) || 0,
          penaltyCollected: Number(r.fc_penalty_collected) || 0,
          maturityDate: r.fc_maturity_date || "",
        };
      })
      // Sort: open loans by overdue desc, then closed at the bottom.
      .sort((a, b) => {
        if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
        return (b.currentOD - a.currentOD) || (b.principalOutstanding - a.principalOutstanding);
      });

    // Customer metadata (use the first row as representative).
    const first = rows[0] || {};
    const customer = first.customer_number ? {
      name: first.customer_name || "",
      customerNumber: first.customer_number || "",
      phone: first.mobile_number || "",
      aadhaar: first.aadhaar_number || "",
      branch: first.branch || "",
    } : null;

    res.json({
      found: loans.length > 0,
      customer,
      loans,
      snapshotDate: latestPool || null,
      accruedDate: latestAccrued || null,
    });
  } catch (e) {
    console.error("[customers/loans]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/od/portfolio-totals?branch=
// Returns the total OD (principal_overdue + interest_overdue) from the LATEST
// pool snapshot, split by loan type:
//   - "group"      → customers whose group_name or center_name is populated
//   - "individual" → everyone else
// Used by the dashboard KPI cards ("Group OD Amount" / "Individual OD Amount").
app.get("/api/od/portfolio-totals", (req, res) => {
  try {
    const branch = String(req.query.branch || "").trim();
    const latest = db.prepare("SELECT MAX(snapshot_date) AS d FROM pool_snapshots").get()?.d;
    if (!latest) {
      return res.json({ snapshotDate: null, groupOdAmount: 0, individualOdAmount: 0, groupAccounts: 0, individualAccounts: 0 });
    }
    // Classification is driven by the Pool Report's "Category of Loan" column
    // (ingested into customers.loan_category). Rows with a blank/unknown
    // loan_category fall back to the legacy group_name/center_name heuristic
    // so existing pool data without the column still shows up on some tab.
    let sql = `
      SELECT
        CASE
          WHEN UPPER(COALESCE(c.loan_category,'')) LIKE '%GROUP%'      THEN 'group'
          WHEN UPPER(COALESCE(c.loan_category,'')) LIKE '%INDIVIDUAL%' THEN 'individual'
          WHEN (c.group_name IS NOT NULL AND c.group_name <> '')
            OR (c.center_name IS NOT NULL AND c.center_name <> '')    THEN 'group'
          ELSE 'individual'
        END AS type,
        SUM(COALESCE(p.principal_overdue, 0) + COALESCE(p.interest_overdue, 0)) AS amount,
        COUNT(*) AS accounts
      FROM pool_snapshots p
      LEFT JOIN customers c ON c.loan_account_no = p.loan_account_no
      WHERE p.snapshot_date = ?
        AND (COALESCE(p.principal_overdue, 0) + COALESCE(p.interest_overdue, 0)) > 0
    `;
    const params = [latest];
    if (branch) { sql += " AND p.branch = ?"; params.push(branch); }
    sql += " GROUP BY type";
    const rows = db.prepare(sql).all(...params);
    const result = { snapshotDate: latest, groupOdAmount: 0, individualOdAmount: 0, groupAccounts: 0, individualAccounts: 0 };
    for (const r of rows) {
      if (r.type === "group") { result.groupOdAmount = r.amount || 0; result.groupAccounts = r.accounts || 0; }
      else                    { result.individualOdAmount = r.amount || 0; result.individualAccounts = r.accounts || 0; }
    }
    res.json(result);
  } catch (e) {
    console.error("[od/portfolio-totals]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pool/search?name=XXXX
app.get("/api/pool/search", (req, res) => {
  try {
    const { name } = req.query;
    if (!name || name.trim().length < 2) return res.json({ found: false, count: 0, results: [] });
    const rows = db.prepare(POOL_JOIN + " WHERE UPPER(c.customer_name) LIKE ? LIMIT 50").all("%" + name.trim().toUpperCase() + "%");
    const results = rows.map(mapPoolRow).map(calcInterestTillDate);
    const reportDate = results[0]?.reportDate || "";
    res.json({ found: results.length > 0, count: results.length, reportDate, results });
  } catch (e) {
    console.error("[pool/search]", e.message);
    res.json({ found: false, count: 0, results: [] });
  }
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

// ─── Schedule: Monthly rollup at 2:55 AM, right before the 3 AM purge ─────
// This preserves month-end insights FOREVER before daily snapshots roll off.
cron.schedule("55 2 * * *", () => {
  try {
    const r = rollupMonthlySnapshots({ trigger: "cron" });
    console.log(`[ROLLUP] Monthly rollup complete:`, r);
  } catch (err) {
    console.error(`[ROLLUP] Monthly rollup FAILED:`, err);
  }
});

// ─── Schedule: Retention purge of OD snapshots > 90 days at 3:00 AM daily ──
// Belt-and-braces: run the rollup synchronously right before the purge too, so
// if the 2:55 AM job was missed (clock skew, reboot, etc.) we never purge data
// that hasn't been rolled up.
cron.schedule("0 3 * * *", () => {
  try {
    const rr = rollupMonthlySnapshots({ trigger: "pre-purge" });
    console.log(`[ROLLUP] Pre-purge rollup:`, rr);
  } catch (err) {
    console.error(`[ROLLUP] Pre-purge rollup FAILED — skipping purge to stay safe:`, err);
    return;  // Abort the purge if rollup fails — data safety over disk usage.
  }
  const r = purgeOldSnapshots(RETENTION_DAYS);
  console.log(`[RETENTION] Purged snapshots older than ${RETENTION_DAYS} days:`, r);
});

// Also run on server start (catches up after restarts)
setTimeout(() => { checkPTPReminders(); }, 5000);

// Run rollup on startup too — if the box was down at 2:55 AM, catch up now.
setTimeout(() => {
  try {
    const r = rollupMonthlySnapshots({ trigger: "startup" });
    console.log(`[ROLLUP] Startup rollup:`, r);
  } catch (err) {
    console.error(`[ROLLUP] Startup rollup FAILED:`, err);
  }
}, 10000);

// ─── Start server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[OD Pulse API] Running on port ${PORT}`);
  console.log(`[OD Pulse API] Data directory: ${DATA_DIR}`);
  console.log(`[OD Pulse API] SMTP configured: ${!!EMAIL_CONFIG.auth.user}`);
});
