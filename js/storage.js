// Everything is stored on the phone itself (IndexedDB). Nothing is uploaded anywhere.
//
// designs: { id, name, created, updated, bg, world: {w, h}, items: [...], thumb: Blob }
//   bg    = { type: 'photo', imageId } | { type: 'color', color }
//   items = [{ uid, src: { kind: 'lib' | 'mine', id }, x, y, scale, rot, flip }]  (bottom → top)
// images:  { id, kind: 'bg' | 'mine', blob, created, hidden? }

const DB_NAME = 'flower-ideas';  // keep: renaming this would lose everyone's saved arrangements
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('designs')) db.createObjectStore('designs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('images')) {
        const s = db.createObjectStore('images', { keyPath: 'id' });
        s.createIndex('kind', 'kind');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Ask the browser not to clear our data when the phone is low on space. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch { /* not supported — fine */ }
}

// ---------- Designs ----------
export async function listDesigns() {
  const s = await store('designs');
  const all = await promisify(s.getAll());
  return all.sort((a, b) => b.updated - a.updated);
}

export async function getDesign(id) {
  return promisify((await store('designs')).get(id));
}

export async function putDesign(design) {
  return promisify((await store('designs', 'readwrite')).put(design));
}

export async function deleteDesign(id) {
  const design = await getDesign(id);
  await promisify((await store('designs', 'readwrite')).delete(id));
  // Remove the background photo if no other design uses it.
  if (design && design.bg && design.bg.type === 'photo') {
    const others = await listDesigns();
    const stillUsed = others.some(d => d.bg && d.bg.imageId === design.bg.imageId);
    if (!stillUsed) await promisify((await store('images', 'readwrite')).delete(design.bg.imageId));
  }
  await cleanupHiddenImages();
}

// ---------- Images ----------
export async function putImage(kind, blob, extra = {}) {
  const rec = { id: newId(), kind, blob, created: Date.now(), ...extra };
  await promisify((await store('images', 'readwrite')).put(rec));
  return rec;
}

export async function getImage(id) {
  return promisify((await store('images')).get(id));
}

export async function listMyFlowers() {
  const s = await store('images');
  const all = await promisify(s.index('kind').getAll('mine'));
  return all.filter(r => !r.hidden).sort((a, b) => b.created - a.created);
}

/** Give one of "My flowers" a new name. */
export async function renameMyFlower(id, name) {
  const rec = await getImage(id);
  if (!rec) return;
  rec.name = name;
  await promisify((await store('images', 'readwrite')).put(rec));
}

/** Remove from "My flowers". Kept in storage while an arrangement still uses it. */
export async function removeMyFlower(id) {
  const designs = await listDesigns();
  const used = designs.some(d => d.items.some(it => it.src.kind === 'mine' && it.src.id === id));
  if (used) {
    const rec = await getImage(id);
    if (rec) { rec.hidden = true; await promisify((await store('images', 'readwrite')).put(rec)); }
  } else {
    await promisify((await store('images', 'readwrite')).delete(id));
  }
}

async function cleanupHiddenImages() {
  const s = await store('images');
  const hidden = (await promisify(s.index('kind').getAll('mine'))).filter(r => r.hidden);
  if (!hidden.length) return;
  const designs = await listDesigns();
  for (const rec of hidden) {
    const used = designs.some(d => d.items.some(it => it.src.kind === 'mine' && it.src.id === rec.id));
    if (!used) await promisify((await store('images', 'readwrite')).delete(rec.id));
  }
}

// ---------- Small settings (first-time help etc.) ----------
export function getSetting(key) {
  try { return localStorage.getItem('fi:' + key); } catch { return null; }
}
export function setSetting(key, value) {
  try { localStorage.setItem('fi:' + key, value); } catch { /* private mode — fine */ }
}
