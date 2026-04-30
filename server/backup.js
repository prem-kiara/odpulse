/**
 * OD Pulse — Backup & Restore Module
 * Handles creating, storing, listing, and restoring full system backups.
 *
 * Backup ZIP contents:
 *   metadata.json            — timestamp, version, file manifest
 *   data/odpulse.sqlite      — main SQLite database (live backup via SQLite API)
 *   data/entries.json        — all OD collection entries
 *   data/users.json          — user accounts
 *   data/branches.json       — branch list
 *   data/config.json         — system configuration
 *   data/notifications.json  — notification records
 *   uploads/                 — uploaded Excel / report files
 */

const AdmZip  = require("adm-zip");
const fs      = require("fs");
const path    = require("path");
const db      = require("./db");          // better-sqlite3 instance

const APP_VERSION   = "1.0.0";
const DATA_DIR      = path.join(__dirname, "data");
const UPLOADS_DIR   = path.join(__dirname, "uploads");
const BACKUPS_DIR   = path.join(__dirname, "backups");
const MAX_LOCAL_BACKUPS = 15;             // keep last 15 auto-saves

const JSON_FILES = [
  "entries.json",
  "users.json",
  "branches.json",
  "config.json",
  "notifications.json",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureDirs() {
  [BACKUPS_DIR, UPLOADS_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function nowTag() {
  return new Date().toISOString().replace(/[T:]/g, "-").slice(0, 19);
}

function humanSize(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

// ─── Create Backup ──────────────────────────────────────────────────────────

function createBackupZip() {
  ensureDirs();
  const zip      = new AdmZip();
  const manifest = [];
  const tag      = nowTag();

  // 1. Live SQLite backup via better-sqlite3's built-in backup API
  const sqliteDest = path.join(BACKUPS_DIR, `_tmp_backup_${tag}.sqlite`);
  try {
    db.backup(sqliteDest);                // consistent snapshot even under load
    zip.addLocalFile(sqliteDest, "data/", "odpulse.sqlite");
    manifest.push("data/odpulse.sqlite");
    fs.unlinkSync(sqliteDest);           // clean up temp file
  } catch (e) {
    console.error("[Backup] SQLite backup error:", e.message);
    // fall back to file copy
    const raw = path.join(DATA_DIR, "odpulse.sqlite");
    if (fs.existsSync(raw)) {
      zip.addLocalFile(raw, "data/");
      manifest.push("data/odpulse.sqlite");
    }
  }

  // 2. JSON data files
  for (const file of JSON_FILES) {
    const fp = path.join(DATA_DIR, file);
    if (fs.existsSync(fp)) {
      zip.addLocalFile(fp, "data/");
      manifest.push(`data/${file}`);
    }
  }

  // 3. Uploaded files
  if (fs.existsSync(UPLOADS_DIR)) {
    const uploadFiles = fs.readdirSync(UPLOADS_DIR).filter(f =>
      fs.statSync(path.join(UPLOADS_DIR, f)).isFile()
    );
    for (const f of uploadFiles) {
      zip.addLocalFile(path.join(UPLOADS_DIR, f), "uploads/");
      manifest.push(`uploads/${f}`);
    }
  }

  // 4. Metadata
  const metadata = {
    appVersion:  APP_VERSION,
    createdAt:   new Date().toISOString(),
    nodeVersion: process.version,
    fileCount:   manifest.length,
    files:       manifest,
  };
  zip.addFile("metadata.json", Buffer.from(JSON.stringify(metadata, null, 2), "utf8"));

  return { zip, tag, metadata };
}

// ─── Save backup locally (auto/scheduled) ───────────────────────────────────

function saveBackupLocally(zip, tag) {
  ensureDirs();
  const filename = `odpulse-backup-${tag}.zip`;
  const filepath = path.join(BACKUPS_DIR, filename);
  zip.writeZip(filepath);

  // Prune old backups — keep latest MAX_LOCAL_BACKUPS only
  const all = listLocalBackups();
  if (all.length > MAX_LOCAL_BACKUPS) {
    all.slice(MAX_LOCAL_BACKUPS).forEach(b => {
      try { fs.unlinkSync(path.join(BACKUPS_DIR, b.filename)); } catch (_) {}
    });
  }
  return filename;
}

// ─── List local backups ──────────────────────────────────────────────────────

function listLocalBackups() {
  ensureDirs();
  return fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.startsWith("odpulse-backup-") && f.endsWith(".zip"))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, f));
      return {
        filename:  f,
        sizeBytes: stat.size,
        sizeHuman: humanSize(stat.size),
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ─── Restore from ZIP buffer ─────────────────────────────────────────────────

function restoreFromBuffer(zipBuffer) {
  const zip = new AdmZip(zipBuffer);

  // Validate metadata
  const metaEntry = zip.getEntry("metadata.json");
  if (!metaEntry) throw new Error("Invalid backup file — metadata.json missing.");
  const metadata = JSON.parse(metaEntry.getData().toString("utf8"));

  const restored = [];
  const errors   = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || entry.entryName === "metadata.json") continue;

    const name = entry.entryName; // e.g. "data/entries.json" or "uploads/foo.xlsx"

    if (name.startsWith("data/")) {
      const filename = path.basename(name);
      // Skip WAL / SHM — they'll be auto-regenerated
      if (filename.endsWith("-shm") || filename.endsWith("-wal")) continue;

      const destPath = path.join(DATA_DIR, filename);
      try {
        // For SQLite: close is not needed with better-sqlite3 (WAL mode safe write)
        // Write to .restore temp then atomic rename for safety
        const tmpPath = destPath + ".restore";
        fs.writeFileSync(tmpPath, entry.getData());
        if (fs.existsSync(destPath)) fs.renameSync(destPath, destPath + ".bak");
        fs.renameSync(tmpPath, destPath);
        // Remove old bak after successful rename
        try { if (fs.existsSync(destPath + ".bak")) fs.unlinkSync(destPath + ".bak"); } catch (_) {}
        restored.push(name);
      } catch (e) {
        errors.push(`${name}: ${e.message}`);
      }
    } else if (name.startsWith("uploads/")) {
      ensureDirs();
      const filename = path.basename(name);
      if (!filename) continue;
      const destPath = path.join(UPLOADS_DIR, filename);
      try {
        fs.writeFileSync(destPath, entry.getData());
        restored.push(name);
      } catch (e) {
        errors.push(`${name}: ${e.message}`);
      }
    }
  }

  return { metadata, restored, errors };
}

module.exports = {
  createBackupZip,
  saveBackupLocally,
  listLocalBackups,
  restoreFromBuffer,
};
