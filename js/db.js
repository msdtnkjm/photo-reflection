// 端末の中（IndexedDB）に記録と写真を保存する
// - records … ふりかえりの記録（IDごと）
// - photos  … 選んだ写真のコピー（Blob）。Picsumが止まっても、電波がなくても履歴の写真が見られる
// 記録は端末の外には出ない

const DB_NAME = 'photo-reflection';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 1回の読み書きを Promise で包む
async function run(storeName, mode, fn) {
  dbPromise ??= openDb();
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const allRecords = () => run('records', 'readonly', (s) => s.getAll());
export const putRecord = (rec) => run('records', 'readwrite', (s) => s.put(rec));
export const deleteRecord = (id) => run('records', 'readwrite', (s) => s.delete(id));

export const getPhoto = async (id) => (await run('photos', 'readonly', (s) => s.get(id)))?.blob ?? null;
export const hasPhoto = async (id) => (await run('photos', 'readonly', (s) => s.count(id))) > 0;
export const putPhoto = (id, blob) => run('photos', 'readwrite', (s) => s.put({ id, blob }));
export const deletePhoto = (id) => run('photos', 'readwrite', (s) => s.delete(id));

// ブラウザの容量が足りなくなっても、勝手に消されにくくするようお願いする
export async function askPersistentStorage() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
