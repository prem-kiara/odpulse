/**
 * End-to-end check of OD Pulse's authentication, against the REAL server
 * process — not a stand-in. Every case below is either something that worked
 * for an outsider on 2026-10-08, or something that has to keep working for
 * staff.
 *
 *   node server/test/auth.test.mjs
 *
 * It starts its OWN server on a spare port with a throwaway data directory
 * (OD_PORT / OD_DATA_DIR), seeded with four known accounts whose passwords are
 * in plaintext — so the boot-time conversion to scrypt hashes is exercised too.
 * It never reads or writes server/data, so it is safe to run on the live box,
 * and it cleans up after itself.
 *
 * If you remove the guard in server/index.js:
 *     app.use("/api", auth.requireSession);
 * sections 1, 2 and 5 go red, reporting 200 where a 401 belongs. That is the
 * check that this file is worth anything.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.OD_TEST_PORT) || 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER = path.join(import.meta.dirname, "..", "index.js");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "odpulse-authtest-"));
// Plaintext on purpose — the server must hash these at boot and flag them all,
// because every password in the real file was readable by anyone until the day
// this test was written.
fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify([
  { id: "admin",  username: "admin",     password: "TestAdmin_9f2x", role: "admin", name: "Test Admin", branch: "Head Office", active: true,  mustChangePassword: false },
  { id: "u_test", username: "teststaff", password: "TestStaff_7k1z", role: "staff", name: "Test Staff", branch: "Annur",       active: true,  mustChangePassword: false },
  { id: "u_flag", username: "flagged",   password: "TestFlag_5m3q",  role: "staff", name: "Flagged",    branch: "Annur",       active: true,  mustChangePassword: true  },
  { id: "u_off",  username: "disabled",  password: "TestOff_3p8w",   role: "staff", name: "Disabled",   branch: "Annur",       active: false, mustChangePassword: false },
], null, 2));
fs.writeFileSync(path.join(dataDir, "entries.json"), JSON.stringify([
  { id: "e1", customerName: "Fixture One",   enteredBy: "u_test", enteredByName: "Test Staff", date: "2026-10-01", branch: "Annur" },
  { id: "e2", customerName: "Fixture Two",   enteredBy: "admin",  enteredByName: "Test Admin", date: "2026-10-02", branch: "Annur" },
  { id: "e3", customerName: "Fixture Three", enteredBy: "u_flag", enteredByName: "Flagged",    date: "2026-10-03", branch: "Annur" },
], null, 2));

const child = spawn(process.execPath, [SERVER], {
  env: { ...process.env, OD_PORT: String(PORT), OD_DATA_DIR: dataDir, OD_ADMIN_PASSWORD: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (d) => { serverLog += d; });
child.stderr.on("data", (d) => { serverLog += d; });

const cleanup = () => {
  try { child.kill("SIGKILL"); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
};
process.on("exit", cleanup);

// Wait for it to answer, and say something useful if it never does.
let up = false;
for (let i = 0; i < 100; i++) {
  try {
    const r = await fetch(`${BASE}/api/health`);
    if (r.ok) { up = true; break; }
  } catch { /* not listening yet */ }
  await new Promise((r) => setTimeout(r, 200));
}
if (!up) {
  console.error(`The test server never came up on ${PORT}. Its output was:\n${serverLog}`);
  process.exit(1);
}
if (!/\[auth\] hashed 4 password\(s\)/.test(serverLog)) {
  console.error(`Expected the boot-time password conversion to run. Server said:\n${serverLog}`);
  process.exit(1);
}
console.log("  (test server up; it converted the four seeded plaintext passwords to scrypt hashes)");
let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? "  → " + detail : ""}`); }
};

const call = async (path, opts = {}) => {
  const res = await fetch(BASE + path, { redirect: "manual", ...opts });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie?.() || [] };
};
const cookieOf = (setCookie) => (setCookie.find((c) => c.startsWith("od_session=")) || "").split(";")[0];

console.log("\n── 1. What the intruder did on 8 October ──────────────────────");
{
  const r = await call("/api/entries");
  ok(r.status === 401, "GET /api/entries without a session is refused", `got ${r.status}`);
  const r2 = await call("/api/users");
  ok(r2.status === 401, "GET /api/users without a session is refused", `got ${r2.status}`);
  // Field/hash, not the substring "password" — "mustChangePassword" is a flag.
  ok(!/"password(Hash)?"\s*:/.test(r2.text) && !/scrypt\$/.test(r2.text),
     "...and nothing in that response carries a password or a hash");
  const r3 = await call("/api/notifications");
  ok(r3.status === 401, "GET /api/notifications without a session is refused", `got ${r3.status}`);
  // The write they made.
  const r4 = await call("/api/entries", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify([]),
  });
  ok(r4.status === 401, "POST /api/entries (full replace) without a session is refused", `got ${r4.status}`);
}

console.log("\n── 2. The headers that used to BE the permission check ────────");
{
  const h = { "x-od-role": "admin", "x-od-user": "admin" };
  const r = await call("/api/users", { headers: h });
  ok(r.status === 401, "a self-declared admin header is no longer an admin", `got ${r.status}`);
  const r2 = await call("/api/users/u_test", { method: "DELETE", headers: h });
  ok(r2.status === 401, "...nor can it delete a user", `got ${r2.status}`);
  const r3 = await call("/api/notifications/export", {
    method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: "{}",
  });
  ok(r3.status === 401, "...nor export the notification report", `got ${r3.status}`);
}

console.log("\n── 3. The open health check says nothing about the business ───");
{
  const r = await call("/api/health");
  ok(r.status === 200, "health answers without a session (the deploy script polls it)");
  ok(!r.json?.counts && !r.json?.dataDir, "...and reports no row counts or data path", JSON.stringify(r.json));
}

console.log("\n── 4. Signing in ─────────────────────────────────────────────");
let adminCookie = "";
{
  const bad = await call("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrong-password" }),
  });
  ok(bad.status === 401, "a wrong password is refused", `got ${bad.status}`);
  ok(/Incorrect username or password/.test(bad.text), "...with one message for every failure");

  const nobody = await call("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "no-such-person", password: "whatever" }),
  });
  ok(nobody.json?.error === bad.json?.error, "...the same message as for an unknown username (no user list to mine)");

  const good = await call("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "TestAdmin_9f2x" }),
  });
  ok(good.status === 200, "the right password signs in", `got ${good.status} ${good.text.slice(0, 120)}`);
  const raw = good.setCookie.find((c) => c.startsWith("od_session=")) || "";
  ok(/HttpOnly/i.test(raw), "the session cookie is HttpOnly (page scripts cannot read it)");
  ok(/SameSite=Lax/i.test(raw), "...and SameSite=Lax (another site cannot drive it)");
  // NOT /password/i — that matches the "mustChangePassword" flag, which is a
  // flag, not a credential. Look for a password FIELD or a stored hash.
  ok(!/"password(Hash)?"\s*:/.test(good.text) && !/scrypt\$/.test(good.text),
     "the sign-in response carries no password field and no hash", good.text.slice(0, 160));
  ok(good.json?.mustChangePassword === true, "every migrated account must change its password (all of them leaked)");
  adminCookie = cookieOf(good.setCookie);
}

console.log("\n── 5. A flagged account can do nothing but change it ─────────");
{
  const r = await call("/api/entries", { headers: { cookie: adminCookie } });
  ok(r.status === 403 && r.json?.error === "PASSWORD_CHANGE_REQUIRED",
     "the book stays shut until the password is replaced", `got ${r.status} ${r.text.slice(0, 80)}`);
  const me = await call("/api/auth/me", { headers: { cookie: adminCookie } });
  ok(me.status === 200, "...but it can ask who it is");

  const weak = await call("/api/auth/change-password", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ currentPassword: "TestAdmin_9f2x", newPassword: "Dhanam@123" }),
  });
  ok(weak.status === 400, "a password that leaked is refused as the new one", `got ${weak.status}`);

  const wrongCurrent = await call("/api/auth/change-password", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ currentPassword: "not-my-password", newPassword: "Sunflower_Harbour_41" }),
  });
  ok(wrongCurrent.status === 400, "a change without the current password is refused", `got ${wrongCurrent.status}`);

  const done = await call("/api/auth/change-password", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ currentPassword: "TestAdmin_9f2x", newPassword: "Sunflower_Harbour_41" }),
  });
  ok(done.status === 200, "a real change is accepted", `got ${done.status} ${done.text.slice(0, 120)}`);
  adminCookie = cookieOf(done.setCookie) || adminCookie;
  ok(!!cookieOf(done.setCookie), "...and the session is re-issued without the lock");

  const after = await call("/api/entries", { headers: { cookie: adminCookie } });
  ok(after.status === 200, "the admin can now read the book", `got ${after.status}`);

  const old = await call("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "TestAdmin_9f2x" }),
  });
  ok(old.status === 401, "the old password no longer works", `got ${old.status}`);
}

console.log("\n── 6. Passwords never leave the server ───────────────────────");
{
  const r = await call("/api/users", { headers: { cookie: adminCookie } });
  ok(r.status === 200, "an admin can still list the staff");
  ok(Array.isArray(r.json) && r.json.length >= 3, "...and gets every row", `${r.json?.length} rows`);
  ok(!/"password"/.test(r.text), "no plaintext password field is sent");
  ok(!/passwordHash|scrypt\$/.test(r.text), "and not the hash either — nothing to crack offline");
  ok(r.json.every((u) => u.username && u.role), "the fields the app needs are still there");
}

console.log("\n── 7. A forged or expired cookie is not a session ────────────");
{
  const tampered = adminCookie.slice(0, -3) + "AAA";
  const r = await call("/api/users", { headers: { cookie: tampered } });
  ok(r.status === 401, "a cookie with a broken signature is refused", `got ${r.status}`);
  // A payload an attacker would love: admin, far future, no signature.
  const forged = "od_session=" + Buffer.from(JSON.stringify({
    uid: "admin", role: "admin", exp: Date.now() + 1e10,
  })).toString("base64url") + ".not-a-real-signature";
  const r2 = await call("/api/users", { headers: { cookie: forged } });
  ok(r2.status === 401, "a hand-written admin cookie is refused", `got ${r2.status}`);
}

console.log("\n── 8. Staff see their own work; only an admin rewrites roles ──");
let staffCookie = "";
{
  const login = await call("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "teststaff", password: "TestStaff_7k1z" }),
  });
  ok(login.status === 200, "a staff member signs in", `got ${login.status}`);
  staffCookie = cookieOf(login.setCookie);
  const change = await call("/api/auth/change-password", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: staffCookie },
    body: JSON.stringify({ currentPassword: "TestStaff_7k1z", newPassword: "Lantern_Bridge_77" }),
  });
  staffCookie = cookieOf(change.setCookie) || staffCookie;

  const entries = await call("/api/entries", { headers: { cookie: staffCookie } });
  ok(entries.status === 200, "staff can read entries", `got ${entries.status}`);
  ok(Array.isArray(entries.json) && entries.json.every((e) => !e || e.enteredBy === "u_test"),
     "...only their own, scoped from the session rather than a header they set");

  const replaceUsers = await call("/api/users", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: staffCookie },
    body: JSON.stringify([{ id: "u_test", username: "teststaff", role: "admin", active: true }]),
  });
  ok(replaceUsers.status === 403, "a staff member cannot replace the user list (that is a role grant)", `got ${replaceUsers.status}`);

  const stillStaff = await call("/api/auth/me", { headers: { cookie: staffCookie } });
  ok(stillStaff.json?.user?.role === "staff", "...and is still staff afterwards");

  const del = await call("/api/users/u_flag", { method: "DELETE", headers: { cookie: staffCookie } });
  ok(del.status === 403, "nor delete another user", `got ${del.status}`);
}

console.log("\n── 9. An admin replace keeps everyone's credential ───────────");
{
  // The client cannot send passwords back (it never receives them), so a blind
  // full replace would have wiped every hash and locked the company out.
  const list = await call("/api/users", { headers: { cookie: adminCookie } });
  const put = await call("/api/users", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify(list.json.map((u) => ({ ...u, branch: u.branch || "Head Office" }))),
  });
  ok(put.status === 200, "an admin may replace the list", `got ${put.status}`);
  const again = await call("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "teststaff", password: "Lantern_Bridge_77" }),
  });
  ok(again.status === 200, "...and the staff password still works afterwards", `got ${again.status}`);
}

console.log("\n── 10. Guessing is throttled ─────────────────────────────────");
{
  let last = 0;
  for (let i = 0; i < 10; i++) {
    const r = await call("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "flagged", password: `guess-${i}` }),
    });
    last = r.status;
  }
  ok(last === 429, "a run of wrong passwords is locked out", `got ${last}`);
  const other = await call("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Sunflower_Harbour_41" }),
  });
  ok(other.status === 200, "...without locking out a different account", `got ${other.status}`);
}

console.log("\n── 11. Signing out ends the session ──────────────────────────");
{
  const out = await call("/api/auth/logout", { method: "POST", headers: { cookie: staffCookie } });
  ok(out.status === 200, "logout answers");
  const cleared = out.setCookie.find((c) => c.startsWith("od_session=")) || "";
  ok(/Max-Age=0/.test(cleared), "...and clears the cookie in the browser");
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
if (fail > 0) console.log("Server output:\n" + serverLog);
cleanup();
process.exit(fail === 0 ? 0 : 1);
