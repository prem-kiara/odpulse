/**
 * Real authentication for OD Pulse (2026-10-09).
 *
 * WHAT WAS THERE BEFORE, and why this exists:
 *
 *   · No authentication at all. Every /api route answered anyone. On
 *     2026-10-08 the address 23.153.36.167 fetched /api/entries (1.8 MB) and
 *     /api/notifications (25 KB) with no account, and POSTed to /api/entries.
 *   · GET /api/users returned the whole staff list WITH PLAINTEXT PASSWORDS.
 *     It was taken three times. Eleven NCD logins reused those passwords.
 *   · The only "permission" check read the x-od-role HEADER, which the caller
 *     sets itself — `curl -H 'x-od-role: admin'` was an admin.
 *   · Login happened in the BROWSER: the page downloaded every user and
 *     compared the typed password in JavaScript.
 *
 * WHAT IT IS NOW: passwords are scrypt hashes, the server checks them, and the
 * answer is a signed httpOnly cookie the browser cannot read or forge. Role and
 * identity come from that cookie — never from a header the caller controls.
 *
 * No new npm dependencies on purpose: scrypt and HMAC are in node's crypto, so
 * this needs no install step on a live server.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.OD_DATA_DIR || path.join(__dirname, "data");  // see server/index.js
const SECRET_FILE = path.join(DATA_DIR, ".session-secret");
const COOKIE = "od_session";
const SESSION_HOURS = 12;

// ─── the signing secret ─────────────────────────────────────────────────────
// Persisted so a restart does not sign everyone out. Mode 0600, and it must
// never be committed — see .gitignore.
function sessionSecret() {
  if (process.env.OD_SESSION_SECRET) return process.env.OD_SESSION_SECRET;
  try {
    if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, "utf8").trim();
  } catch { /* fall through and make one */ }
  const s = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  } catch (e) {
    console.error("[auth] could not persist the session secret; sessions will not survive a restart:", e.message);
  }
  return s;
}
const SECRET = sessionSecret();

// ─── passwords ──────────────────────────────────────────────────────────────
/** scrypt, salted per password. Stored as scrypt$<salt>$<hash>. */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(plain), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/**
 * True when `plain` is the password behind `stored`.
 *
 * Accepts a legacy PLAINTEXT value too, so a user row that has not been
 * migrated yet still lets its owner in — migrateUserPasswords() converts them
 * at boot, and this is only the belt to that braces. Compared in constant time
 * either way.
 */
function verifyPassword(plain, stored) {
  if (!stored) return false;
  const s = String(stored);
  if (!s.startsWith("scrypt$")) {
    const a = Buffer.from(String(plain));
    const b = Buffer.from(s);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const [, salt, hash] = s.split("$");
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(plain), salt, 64);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** Has this row been converted yet? */
function isHashed(stored) {
  return typeof stored === "string" && stored.startsWith("scrypt$");
}

// ─── sessions ───────────────────────────────────────────────────────────────
function sign(payloadB64) {
  return crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
}

function issueToken(user) {
  const payload = {
    uid: user.id,
    name: user.name || user.username || "",
    username: user.username || "",
    role: user.role || "staff",
    branch: user.branch || "",
    mustChange: !!user.mustChangePassword,
    exp: Date.now() + SESSION_HOURS * 3600 * 1000,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${b64}.${sign(b64)}`;
}

/** The session carried by this request, or null. Forged or expired → null. */
function readToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [b64, mac] = token.split(".");
  if (!b64 || !mac) return null;
  const expected = sign(b64);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
    if (!p || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

/** Cookie parsing without a dependency. */
function cookieFrom(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(res, token) {
  const bits = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",                 // JavaScript cannot read it, so XSS cannot steal it
    "SameSite=Lax",
    `Max-Age=${SESSION_HOURS * 3600}`,
  ];
  // The app is served over HTTPS; Secure keeps the cookie off plain HTTP.
  if (process.env.NODE_ENV === "production") bits.push("Secure");
  res.setHeader("Set-Cookie", bits.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Attach req.session (or null). Never throws. */
function attachSession(req, _res, next) {
  req.session = readToken(cookieFrom(req, COOKIE));
  next();
}

/**
 * Everything needs a session except signing in — and a user who must change
 * their password can do only that.
 *
 * The allow-list is deliberately tiny. /api/health stays open because the
 * deploy script and nginx check it, and it says nothing but "up".
 */
const OPEN_PATHS = new Set(["/api/auth/login", "/api/health"]);
const LOCKED_OUT_EXCEPT = new Set(["/api/auth/me", "/api/auth/logout", "/api/auth/change-password"]);

function requireSession(req, res, next) {
  const p = req.path.startsWith("/api") ? req.path : `/api${req.path}`;
  if (OPEN_PATHS.has(p)) return next();
  if (!req.session) return res.status(401).json({ error: "Please sign in." });
  if (req.session.mustChange && !LOCKED_OUT_EXCEPT.has(p)) {
    return res.status(403).json({ error: "PASSWORD_CHANGE_REQUIRED", message: "Set a new password before continuing." });
  }
  next();
}

/** Admin only — for anything that rewrites a whole data file. */
function requireAdmin(req, res, next) {
  if (!req.session) return res.status(401).json({ error: "Please sign in." });
  if (req.session.role !== "admin") return res.status(403).json({ error: "Administrators only." });
  next();
}

/** Never let a password — hashed or not — leave the building. */
function publicUser(u) {
  if (!u || typeof u !== "object") return u;
  const { password, passwordHash, ...rest } = u;
  void password; void passwordHash;
  return rest;
}

/**
 * One-time conversion of plaintext passwords to scrypt hashes.
 *
 * Runs at boot, writes only if something actually changed, and flags every
 * account whose password was in the leaked file so the holder must replace it.
 */
function migrateUserPasswords(loadJSON, saveJSON, seed) {
  // The seed matters: loadJSON writes its fallback when the file is missing, so
  // passing [] here would create an EMPTY users.json on a fresh install and
  // lock everybody out.
  const users = loadJSON("users.json", seed || []);
  if (!Array.isArray(users) || !users.length) return { converted: 0, flagged: 0 };
  let converted = 0;
  let flagged = 0;
  const next = users.map((u) => {
    if (!u || typeof u !== "object" || typeof u.password !== "string") return u;
    const out = { ...u };
    const plain = out.password;
    delete out.password;
    if (isHashed(plain)) {
      out.passwordHash = plain;          // already a hash, just under the old key
    } else {
      out.passwordHash = hashPassword(plain);
      // users.json was readable by anyone until 2026-10-08 and was taken three
      // times, so EVERY password in it is compromised — not only the two
      // defaults. All of them must be replaced at next sign-in.
      out.mustChangePassword = true;
      flagged += 1;
    }
    converted += 1;
    return out;
  });
  if (converted) {
    saveJSON("users.json", next);
    console.log(`[auth] hashed ${converted} password(s); ${flagged} must be changed at next sign-in`);
  }
  return { converted, flagged };
}

module.exports = {
  COOKIE,
  hashPassword,
  verifyPassword,
  isHashed,
  issueToken,
  readToken,
  setSessionCookie,
  clearSessionCookie,
  attachSession,
  requireSession,
  requireAdmin,
  publicUser,
  migrateUserPasswords,
};
