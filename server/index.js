const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const nodemailer = require("nodemailer");

const app = express();
const PORT = 3001;
const DATA_DIR = path.join(__dirname, "data");

// ─── Ensure data directory exists ───────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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

const DEFAULT_CONFIG = { companyName: "OD Pulse - MFI Recovery Tracker", allowStaffEdit: false, allowStaffDelete: false, staffSeeAllBranches: false };

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
app.post("/api/entries/append", (req, res) => {
  const entries = loadJSON("entries.json", []);
  entries.unshift(req.body);
  saveJSON("entries.json", entries);
  res.json({ ok: true, count: entries.length });
});

// Manual PTP reminder trigger
app.post("/api/ptp-check", async (req, res) => {
  await checkPTPReminders();
  res.json({ ok: true, message: "PTP check completed" });
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
    const msg = `PTP Reminder (${urgency}): Collect cash payment from ${entry.customerName} (${entry.customerId}) - Branch: ${entry.branch} - PTP Date: ${formatDMY(entry.ptpDate)} - Amount: Rs. ${entry.groupOdPaidAmount || entry.totalPaidAmount || "N/A"}`;

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

// Also run on server start (catches up after restarts)
setTimeout(() => { checkPTPReminders(); }, 5000);

// ─── Start server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[OD Pulse API] Running on port ${PORT}`);
  console.log(`[OD Pulse API] Data directory: ${DATA_DIR}`);
  console.log(`[OD Pulse API] SMTP configured: ${!!EMAIL_CONFIG.auth.user}`);
});
