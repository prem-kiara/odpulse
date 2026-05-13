// IndexedDB-backed queue for OD collection entries.
//
// When the backend is unreachable at save time, the entry is persisted here
// and retried on every app load and online event. Survives page refreshes,
// browser restarts, and intermittent connectivity — the kind of network
// flakiness that was causing entries to silently disappear in May 2026.
//
// Stored shape (one record per failed save attempt):
//   { id (autoincrement), entry (the full entry object), queuedAt, attempts,
//     lastError }

const DB_NAME = "odpulse-entry-queue";
const DB_VERSION = 1;
const STORE = "pending-entries";

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
    req.onerror = (e) => reject(e.target.error);
  });
  return _dbPromise;
}

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

// Add an entry to the queue. Returns the queued record (with auto-id).
export async function enqueueEntry(entry, errorMsg) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const payload = {
      entry,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      lastError: errorMsg || null,
    };
    const req = store.add(payload);
    req.onsuccess = () => resolve({ ...payload, id: req.result });
    req.onerror  = () => reject(req.error);
  });
}

export async function listQueuedEntries() {
  const store = await tx("readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror  = () => reject(req.error);
  });
}

export async function deleteQueuedEntry(id) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror  = () => reject(req.error);
  });
}

export async function updateQueuedEntry(id, patch) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
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
}

// Drain the queue against `apiBase`. For each pending entry, POST to
// `${apiBase}/entries/append`. On success (or a 200/duplicate), remove the
// item from the queue. On failure, increment attempts and keep it for the
// next drain. Returns { attempted, succeeded, failed, stillDown }.
//
// Stops early if the server appears unreachable (network error) to avoid
// hammering it; the next drain cycle will pick up where we left off.
export async function drainEntryQueue(apiBase) {
  const items = await listQueuedEntries();
  const result = { attempted: 0, succeeded: 0, failed: 0, stillDown: false, drained: [] };
  for (const item of items) {
    result.attempted += 1;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${apiBase}/entries/append`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.entry),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok && res.status !== 409) {
        // 4xx other than 409-duplicate → not a transient failure; surface it
        // but still leave the item queued so admin can inspect.
        let body = "";
        try { body = await res.text(); } catch {}
        throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
      }
      await deleteQueuedEntry(item.id);
      result.succeeded += 1;
      result.drained.push(item.entry);
    } catch (err) {
      result.failed += 1;
      const msg = err?.message || String(err);
      const isNetwork = /Failed to fetch|NetworkError|aborted|abort/i.test(msg);
      await updateQueuedEntry(item.id, {
        attempts: (item.attempts || 0) + 1,
        lastError: msg.slice(0, 300),
      });
      if (isNetwork) {
        result.stillDown = true;
        break; // server's still down; don't keep trying
      }
    }
  }
  return result;
}
