// Lightweight IndexedDB-backed queue for OD uploads.
//
// When the backend is unreachable, files + metadata are persisted here and
// retried automatically when the API comes back. Survives page refreshes.
//
// Records are of the shape:
//   { id, kind, file (Blob), filename, snapshotDate, periodStart, periodEnd,
//     userRole, userName, queuedAt, attempts, lastError }

const DB_NAME = "odpulse-upload-queue";
const DB_VERSION = 1;
const STORE = "pending";

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

export async function enqueueUpload(record) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const payload = { ...record, queuedAt: new Date().toISOString(), attempts: 0, lastError: null };
    const req = store.add(payload);
    req.onsuccess = () => resolve({ ...payload, id: req.result });
    req.onerror = () => reject(req.error);
  });
}

export async function listQueue() {
  const store = await tx("readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFromQueue(id) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function updateQueueItem(id, patch) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const get = store.get(id);
    get.onsuccess = () => {
      const item = get.result;
      if (!item) return resolve(false);
      const merged = { ...item, ...patch };
      const put = store.put(merged);
      put.onsuccess = () => resolve(merged);
      put.onerror = () => reject(put.error);
    };
    get.onerror = () => reject(get.error);
  });
}

// Drain the queue by calling `sendFn(item)` for each pending record.
// sendFn must return a Promise that resolves on success or rejects on failure.
// On success the item is deleted; on failure attempts is incremented.
// Stops early if sendFn rejects with err.networkError === true (backend still down).
export async function drainQueue(sendFn) {
  const items = await listQueue();
  const result = { attempted: 0, succeeded: 0, failed: 0, stillDown: false };
  for (const item of items) {
    result.attempted += 1;
    try {
      await sendFn(item);
      await deleteFromQueue(item.id);
      result.succeeded += 1;
    } catch (err) {
      result.failed += 1;
      await updateQueueItem(item.id, {
        attempts: (item.attempts || 0) + 1,
        lastError: err?.message?.slice(0, 300) || "Unknown error",
      });
      if (err?.networkError) {
        result.stillDown = true;
        break;  // Don't hammer the server; try again next cycle.
      }
    }
  }
  return result;
}

// Probe the backend. Returns true if reachable.
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
