// Built-in flower pictures. The list lives in flowers/library.json (also used by
// sw.js for offline use and by credits.html), so there is only one place to edit.
//
// To add a picture: put a transparent .webp or .png in flowers/ and add an entry
// to flowers/library.json with its source and licence.

let LIBRARY = [];
let byId = new Map();

export async function loadLibrary() {
  try {
    const res = await fetch('flowers/library.json');
    LIBRARY = await res.json();
  } catch (err) {
    console.warn('Could not load the flower list', err);
    LIBRARY = [];
  }
  byId = new Map(LIBRARY.map(f => [f.id, f]));
}

export function libraryItem(id) { return byId.get(id); }

export function libraryFor(cat) { return LIBRARY.filter(f => f.cat === cat); }
