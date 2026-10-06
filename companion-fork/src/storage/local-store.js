const DB_NAME = 'companion-local';
const DB_VERSION = 1;
const STORE = 'workspace';
const KEY = 'current';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir el almacenamiento local.'));
  });
}

export async function loadWorkspace() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result ?? { schemaVersion: DB_VERSION, draft: null, seed: null });
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkspace(workspace) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...workspace, schemaVersion: workspace.schemaVersion ?? DB_VERSION, savedAt: new Date().toISOString() }, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar el progreso.'));
    tx.onabort = () => reject(tx.error ?? new Error('El guardado se interrumpió.'));
  });
}
