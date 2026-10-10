/** Account-scoped lead cache. Never trust a stored login as authorization. */
const DB_NAME = 'tn-field-map';
const STORE = 'leads';
export function leadCacheScope(projectUrl, userId) {
  if (!projectUrl || !userId) return '';
  return `verified:${encodeURIComponent(projectUrl)}:${encodeURIComponent(userId)}`;
}
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error || new Error('indexedDB open failed'));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function readLeadCache(scope) {
  if (!scope) return null;
  let db;
  try {
    db = await openDb();
    return await new Promise(resolve => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(scope);
      request.onsuccess = () => resolve(request.result?.scope === scope ? request.result : null);
      request.onerror = () => resolve(null);
    });
  } catch { return null; }
  finally { db?.close(); }
}
async function mutate(action) {
  let db;
  try {
    db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      action(tx.objectStore(STORE));
    });
  } catch { /* Cache failure must never block authenticated network reads. */ }
  finally { db?.close(); }
}
export async function writeLeadCache(payload, scope) {
  if (!scope) return;
  await mutate(store => store.put({ ...payload, scope }, scope));
}
export async function clearLeadCache() {
  // Clear legacy unscoped datasets and all accounts on shared-device sign-out.
  await mutate(store => store.clear());
}
