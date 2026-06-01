/**
 * billDraftStore.ts — IndexedDB mirror of UNCOMMITTED POS bill lines (Phase B).
 *
 * Solves the core failure mode: items a server has tapped in but not yet sent
 * ("Service Total"-ed) normally live only in React useState — volatile RAM that
 * a power-cut wipes. This store continuously mirrors those lines to IndexedDB,
 * which is disk-backed and transactional, so an instant crash can be recovered
 * from on the next launch.
 *
 * Separate IndexedDB database from offlineCache.ts so version bumps never
 * collide. Every call is best-effort and never throws into the render path.
 */

const DB_NAME = 'villa_gianni_bill_drafts';
const DB_VERSION = 1;
const STORE = 'drafts';

interface DraftRecord<T = any> { key: string; lines: T[]; updatedAt: number; }

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Mirror the current uncommitted lines for a table. Overwrites the prior draft. */
export async function putDraft<T>(key: string, lines: T[]): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE], 'readwrite');
      tx.objectStore(STORE).put({ key, lines, updatedAt: Date.now() } as DraftRecord<T>);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* best-effort */ }
}

/** Read the draft lines for a table, or null if none. */
export async function getDraft<T>(key: string): Promise<T[] | null> {
  try {
    const db = await open();
    return await new Promise<T[] | null>((resolve) => {
      const tx = db.transaction([STORE], 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ? (req.result as DraftRecord<T>).lines : null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

/**
 * Read the draft only if it was written within maxAgeMs (default 24h). Guards
 * against resurrecting an ancient, abandoned draft on recovery.
 */
export async function getRecentDraft<T>(key: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<T[] | null> {
  try {
    const db = await open();
    return await new Promise<T[] | null>((resolve) => {
      const tx = db.transaction([STORE], 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as DraftRecord<T> | undefined;
        if (rec && rec.lines?.length && Date.now() - rec.updatedAt <= maxAgeMs) resolve(rec.lines);
        else resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

/** Drop the draft for a table — call after a successful commit. */
export async function clearDraft(key: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORE], 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

export default { putDraft, getDraft, getRecentDraft, clearDraft };
