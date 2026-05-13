// IndexedDB-backed queue for OD entry operations (create / update / delete).
// Persists failed operations and retries on every app load / online event.
//
// Each record:
//   { id (autoincrement), op: "create"|"update"|"delete", entry, entryId,
//     enteredBy, queuedAt, attempts, lastError }

const DB_NAME  = "odpulse-entry-queue";
const DB_VERSION = 1;
const STORE   = "pending-entries";
const MAX_ATTEMPTS = 50;
const DEAD_LETTER_KEY = "odpulse_entry_queue_dead_letter";
const LS_FALLBACK_KEY = "odpulse_pending_entries_fallback";

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror  = (e) => reject(e.target.error);
  });
  return _dbPromise;
}

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

async function enqueueOp(record) {
  try {
    const store = await tx("readwrite");
    return await new Promise((resolve, reject) => {
      const payload = { ...record, queuedAt: new Date().toISOString(), attempts: 0, lastError: null };
      const req = store.add(payload);
      req.onsuccess = () => resolve({ ...payload, id: req.result });
      req.onerror  = () => reject(req.error);
    });
  } catch (idxErr) {
    try {
      const cur = JSON.parse(localStorage.getItem(LS_FALLBACK_KEY) || "[]");
      cur.unshift({ ...record, queuedAt: new Date().toISOString(), attempts: 0, lastError: "IndexedDB unavailable" });
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(cur));
    } catch {}
    throw idxErr;
  }
}

export async function enqueueEntry(entry, errorMsg) {
  return enqueueOp({
    op: "create",
    entry,
    entryId: entry?.id || null,
    enteredBy: entry?.enteredBy || null,
    lastError: errorMsg || null,
  });
}

export async function enqueueEntryUpdate(entryId, patch, enteredBy, errorMsg) {
  return enqueueOp({
    op: "update",
    entry: patch,
    entryId,
    enteredBy: enteredBy || null,
    lastError: errorMsg || null,
  });
}

export async function enqueueEntryDelete(entryId, enteredBy, errorMsg) {
  return enqueueOp({
    op: "delete",
    entry: null,
    entryId,
    enteredBy: enteredBy || null,
    lastError: errorMsg || null,
  });
}

export async function listQueuedEntries() {
  try {
    const store = await tx("readonly");
    return await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror  = () => reject(req.error);
    });
  } catch { return []; }
}

export async function deleteQueuedEntry(id) {
  try {
    const store = await tx("readwrite");
    return await new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror  = () => reject(req.error);
    });
  } catch { return false; }
}

export async function updateQueuedEntry(id, patch) {
  try {
    const store = await tx("readwrite");
    return await new Promise((resolve, reject) => {
      const get = store.get(id);
      get.onsuccess = () => {
        const item = get.result;
        if (!item) return resolve(false);
        const merged = { ...item, ...patch };
        const put = store.put(merged);
        put.onsuccess = () => resolve(merged);
        put.onerror  = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    });
  } catch { return false; }
}

function appendDeadLetter(record) {
  try {
    const cur = JSON.parse(localStorage.getItem(DEAD_LETTER_KEY) || "[]");
    cur.unshift({ ...record, deadLetteredAt: new Date().toISOString() });
    localStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(cur.slice(0, 500)));
  } catch {}
}

export function listDeadLetters() {
  try { return JSON.parse(localStorage.getItem(DEAD_LETTER_KEY) || "[]"); } catch { return []; }
}

async function sendOne(apiBase, item) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  let res;
  try {
    if (item.op === "create" || !item.op) {
      res = await fetch(apiBase + "/entries/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.entry),
        signal: ctrl.signal,
      });
    } else if (item.op === "update") {
      res = await fetch(apiBase + "/entries/" + encodeURIComponent(item.entryId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.entry || {}),
        signal: ctrl.signal,
      });
    } else if (item.op === "delete") {
      res = await fetch(apiBase + "/entries/" + encodeURIComponent(item.entryId), {
        method: "DELETE",
        signal: ctrl.signal,
      });
    } else {
      throw new Error("Unknown queue op: " + item.op);
    }
  } finally {
    clearTimeout(t);
  }
  // 404 on delete/update means already gone — idempotent success.
  if (res.status === 404 && (item.op === "delete" || item.op === "update")) return;
  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch {}
    const err = new Error("HTTP " + res.status + " " + body.slice(0, 200));
    err.statusCode = res.status;
    throw err;
  }
}

// Drain queue. If currentUserId given, only drain that user's queued items
// (multi-user shared-device safety). MAX_ATTEMPTS cap with dead-letter list.
export async function drainEntryQueue(apiBase, currentUserId) {
  const items = await listQueuedEntries();
  const result = { attempted: 0, succeeded: 0, failed: 0, deadLettered: 0, stillDown: false, drained: [], drainedOps: [] };

  for (const item of items) {
    if (currentUserId && item.enteredBy && item.enteredBy !== currentUserId) continue;
    result.attempted += 1;
    try {
      await sendOne(apiBase, item);
      await deleteQueuedEntry(item.id);
      result.succeeded += 1;
      if ((item.op || "create") === "create" && item.entry) result.drained.push(item.entry);
      result.drainedOps.push({ op: item.op || "create", entry: item.entry, entryId: item.entryId });
    } catch (err) {
      result.failed += 1;
      const msg = err?.message || String(err);
      const isNetwork = /Failed to fetch|NetworkError|aborted|abort/i.test(msg);
      const attempts = (item.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        appendDeadLetter({ ...item, lastError: msg.slice(0, 300), attempts });
        await deleteQueuedEntry(item.id);
        result.deadLettered += 1;
      } else {
        await updateQueuedEntry(item.id, { attempts, lastError: msg.slice(0, 300) });
      }
      if (isNetwork) { result.stillDown = true; break; }
    }
  }

  // Drain the localStorage fallback too — these were captured when IDB itself
  // failed to enqueue, so they would otherwise be invisible to the queue.
  try {
    const fallback = JSON.parse(localStorage.getItem(LS_FALLBACK_KEY) || "[]");
    if (Array.isArray(fallback) && fallback.length > 0) {
      const stillFailing = [];
      for (const f of fallback) {
        if (currentUserId && f.enteredBy && f.enteredBy !== currentUserId) {
          stillFailing.push(f);
          continue;
        }
        try {
          await sendOne(apiBase, f.op ? f : { op: "create", entry: f });
          result.succeeded += 1;
          if ((f.op || "create") === "create") result.drained.push(f.entry || f);
        } catch {
          stillFailing.push(f);
        }
      }
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(stillFailing));
    }
  } catch {}

  return result;
}

export async function isBackendUp(healthUrl = "/api/health") {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(healthUrl, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}
