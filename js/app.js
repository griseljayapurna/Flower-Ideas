// Flower Ideas — screens, saving, the flower tray and help.

import * as db from './storage.js';
import { Editor } from './editor.js';
import { prepareBackground, prepareCutout, readClipboardImage, canvasToBlob } from './images.js';
import { libraryFor, loadLibrary } from './library.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

const COLORS = [
  { color: '#ffffff', name: 'White' },
  { color: '#f6efe1', name: 'Cream' },
  { color: '#e9e4dc', name: 'Stone' },
  { color: '#dfe8dc', name: 'Sage' },
  { color: '#dde7f0', name: 'Sky' },
  { color: '#f3dfe2', name: 'Blush' },
  { color: '#3d3a36', name: 'Dark' },
];

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let current = null;       // the design open in the editor
let saveTimer = 0;
let currentTab = 'flowers';
let homeUrls = [];
let trayUrls = [];

// ---------------------------------------------------------------- helpers

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function busy(on) { $('#busy').hidden = !on; }

/**
 * Simple pop-up. buttons: [{ label, value, style: 'primary'|'ghost'|'danger' }]
 * Resolves with the chosen value (or the typed text when `input` is given).
 */
function dialog({ title, body = '', input = null, buttons, stacked = false }) {
  return new Promise(resolve => {
    const box = $('#dialog');
    $('#dialog-title').textContent = title;
    const bodyEl = $('#dialog-body');
    bodyEl.innerHTML = body;
    let field = null;
    if (input !== null) {
      field = document.createElement('input');
      field.className = 'dialog-input';
      field.type = 'text';
      field.value = input;
      field.maxLength = 60;
      bodyEl.appendChild(field);
    }
    const btnWrap = $('#dialog-buttons');
    btnWrap.className = 'dialog-buttons' + (stacked ? ' stacked' : '');
    btnWrap.innerHTML = '';
    const finish = value => {
      box.hidden = true;
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'btn btn-' + (b.style || 'ghost');
      el.innerHTML = b.label;
      el.addEventListener('click', () => {
        if (b.onClick) { b.onClick(); return; }
        finish(field && b.value === 'ok' ? field.value.trim() : b.value);
      });
      btnWrap.appendChild(el);
    }
    const cancelValue = buttons.some(b => b.value === null) ? null : buttons[buttons.length - 1].value;
    const onKey = e => {
      if (e.key === 'Escape') finish(cancelValue);
      if (e.key === 'Enter' && field) finish(field.value.trim());
    };
    document.addEventListener('keydown', onKey);
    box.hidden = false;
    if (field) setTimeout(() => { field.focus(); field.select(); }, 50);
    else btnWrap.querySelector('button')?.focus();
  });
}

function closeDialog() { $('#dialog').hidden = true; }

function niceDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function defaultName() {
  return 'Arrangement ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------- screens

function show(id, { push = true } = {}) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
  if (push && id !== 'home') history.pushState({ screen: id }, '');
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', async () => {
  // Phone "back" button / gesture.
  if (!$('#dialog').hidden) { closeDialog(); }
  if (!$('#help').hidden) { $('#help').hidden = true; }
  if (current) await leaveEditor({ fromHistory: true });
  else show('home', { push: false });
});

// ---------------------------------------------------------------- home

async function renderHome() {
  homeUrls.forEach(u => URL.revokeObjectURL(u));
  homeUrls = [];
  const designs = await db.listDesigns();
  const grid = $('#design-grid');
  grid.innerHTML = '';
  $('#empty-home').hidden = designs.length > 0;
  $('#saved-title').hidden = designs.length === 0;

  for (const d of designs) {
    const li = document.createElement('li');
    li.className = 'design-card';
    let thumb = '';
    if (d.thumb) {
      const url = URL.createObjectURL(d.thumb);
      homeUrls.push(url);
      thumb = `<img class="design-thumb" src="${url}" alt="">`;
    } else {
      thumb = `<span class="design-thumb" style="background:${d.bg.color || '#eee'}"></span>`;
    }
    li.innerHTML = `
      <button class="design-open" type="button">
        ${thumb}
        <span class="design-name">${escapeHtml(d.name)}</span>
        <span class="design-date">${niceDate(d.updated)}</span>
      </button>
      <button class="design-more" type="button" aria-label="More for ${escapeHtml(d.name)}">⋯</button>`;
    li.querySelector('.design-open').addEventListener('click', () => openDesign(d.id));
    li.querySelector('.design-more').addEventListener('click', () => designMenu(d));
    grid.appendChild(li);
  }
}

async function designMenu(d) {
  const choice = await dialog({
    title: d.name,
    stacked: true,
    buttons: [
      { label: '✏️ Open', value: 'open', style: 'primary' },
      { label: '🔤 Change name', value: 'rename' },
      { label: '⧉ Make a copy', value: 'copy' },
      { label: '🗑️ Delete', value: 'delete' },
      { label: 'Cancel', value: null },
    ],
  });
  if (choice === 'open') openDesign(d.id);
  if (choice === 'rename') {
    const name = await dialog({
      title: 'Change name', input: d.name,
      buttons: [{ label: 'Save', value: 'ok', style: 'primary' }, { label: 'Cancel', value: null }],
    });
    if (name) { d.name = name; await db.putDesign(d); renderHome(); }
  }
  if (choice === 'copy') {
    const copy = { ...d, id: db.newId(), name: d.name + ' (copy)', created: Date.now(), updated: Date.now() };
    await db.putDesign(copy);
    renderHome();
    toast('Copy made');
  }
  if (choice === 'delete') {
    const sure = await dialog({
      title: 'Delete this arrangement?',
      body: `<p>“${escapeHtml(d.name)}” will be gone for good.</p>`,
      buttons: [{ label: 'Yes, delete', value: true, style: 'danger' }, { label: 'No, keep it', value: false, style: 'ghost' }],
    });
    if (sure) { await db.deleteDesign(d.id); renderHome(); toast('Deleted'); }
  }
}

// ---------------------------------------------------------------- new arrangement

function setupNewScreen() {
  const wrap = $('#color-choices');
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'color-choice';
    b.style.background = c.color;
    b.setAttribute('aria-label', c.name + ' background');
    b.title = c.name;
    b.addEventListener('click', () => {
      const landscape = window.innerWidth > window.innerHeight;
      createDesign({ type: 'color', color: c.color }, landscape ? { w: 2000, h: 1500 } : { w: 1500, h: 2000 });
    });
    wrap.appendChild(b);
  }
  for (const id of ['#input-camera', '#input-bg-photo']) {
    $(id).addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      busy(true);
      try {
        const blob = await prepareBackground(file);
        const rec = await db.putImage('bg', blob);
        const size = await imageSize(blob);
        await createDesign({ type: 'photo', imageId: rec.id }, size);
      } catch (err) {
        console.error(err);
        dialog({ title: 'Sorry', body: '<p>That picture could not be opened. Please try a different photo.</p>', buttons: [{ label: 'OK', value: true, style: 'primary' }] });
      } finally {
        busy(false);
      }
    });
  }
}

async function imageSize(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function createDesign(bg, world) {
  const now = Date.now();
  const design = { id: db.newId(), name: defaultName(), created: now, updated: now, bg, world, items: [], thumb: null };
  await db.putDesign(design);
  db.requestPersistence();
  await openDesign(design.id, { replace: true });
}

// ---------------------------------------------------------------- editor

let editor;

function setupEditor() {
  editor = new Editor($('#canvas'), {
    onChange: () => { updateUndo(); scheduleSave(); },
    onSelect: it => {
      $('#selection-bar').hidden = !it;
      updateHint();
    },
  });

  $('#btn-undo').addEventListener('click', () => editor.undo());
  $('#btn-redo').addEventListener('click', () => editor.redo());
  $('#btn-editor-back').addEventListener('click', () => history.back());
  $('#btn-export').addEventListener('click', exportPicture);

  $$('#selection-bar .tool').forEach(b => b.addEventListener('click', () => {
    const r = editor.tool(b.dataset.tool);
    if (r === 'already-front') toast('Already at the front');
    if (r === 'already-back') toast('Already at the back');
  }));

  $$('.tab').forEach(tab => tab.addEventListener('click', () => setTab(tab.dataset.cat)));

  $('#input-my-flower').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) await addCutout(file);
  });

  // Ctrl+V / Cmd+V on a computer, or "Paste" from a keyboard.
  document.addEventListener('paste', async e => {
    if (!current) return;
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); await addCutout(files[0]); }
  });

  document.addEventListener('keydown', e => {
    if (!current || !$('#dialog').hidden) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); editor.redo(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') editor.tool('delete');
    else if (e.key === 'Escape') editor.tool('deselect');
  });

  // Save straight away if the app is closed or switched away from.
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
  window.addEventListener('pagehide', () => flushSave());
}

async function openDesign(id, { replace = false } = {}) {
  const design = await db.getDesign(id);
  if (!design) { toast('Could not find that arrangement'); return; }
  busy(true);
  try {
    current = design;
    if (replace) {
      history.replaceState({ screen: 'editor' }, '');
      $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-editor'));
    } else {
      show('editor');
    }
    await editor.open(design);
    updateUndo();
    updateHint();
    await setTab(currentTab);
    if (!db.getSetting('seen-editor-help')) {
      db.setSetting('seen-editor-help', '1');
      openHelp(1);
    }
  } catch (err) {
    console.error(err);
    toast('Something went wrong opening this arrangement');
  } finally {
    busy(false);
  }
}

async function leaveEditor({ fromHistory = false } = {}) {
  await flushSave();
  editor.close();
  current = null;
  if (fromHistory) show('home', { push: false });
  await renderHome();
}

function updateUndo() {
  $('#btn-undo').disabled = !editor.canUndo();
  $('#btn-redo').disabled = !editor.canRedo();
  updateHint();
}

function updateHint() {
  const hint = $('#stage-hint');
  if (!current) { hint.hidden = true; return; }
  if (editor.items.length === 0) {
    hint.textContent = 'Tap a flower below to add it';
    hint.hidden = false;
  } else if (!editor.selectedItem() && editor.items.length < 3 && !db.getSetting('hint-tap-done')) {
    hint.textContent = 'Tap a flower in the picture to move it';
    hint.hidden = false;
  } else {
    if (editor.selectedItem()) db.setSetting('hint-tap-done', '1');
    hint.hidden = true;
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(), 800);
}

async function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); await saveNow(); }
}

async function saveNow() {
  saveTimer = 0;
  if (!current || !editor.design) return;
  try {
    current.items = editor.getItems();
    current.updated = Date.now();
    const { w, h } = current.world;
    const thumbCanvas = editor.renderToCanvas(360 / Math.max(w, h));
    current.thumb = await canvasToBlob(thumbCanvas, 'image/jpeg', 0.8);
    await db.putDesign(current);
  } catch (err) {
    console.error('Save failed', err);
    toast('Could not save — is the phone full?');
  }
}

// ---------------------------------------------------------------- flower tray

async function setTab(cat) {
  currentTab = cat;
  $$('.tab').forEach(t => {
    const on = t.dataset.cat === cat;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  trayUrls.forEach(u => URL.revokeObjectURL(u));
  trayUrls = [];
  const box = $('#tray-items');
  box.innerHTML = '';
  box.scrollLeft = 0;

  if (cat === 'mine') {
    box.appendChild(actionTile('📋', 'Paste', pasteFlower));
    box.appendChild(actionTile('🖼️', 'Photos', () => $('#input-my-flower').click()));
    const mine = await db.listMyFlowers();
    if (!mine.length) {
      const p = document.createElement('p');
      p.className = 'tray-empty';
      p.innerHTML = 'Flowers you paste or add from your photos will be kept here. Tap <strong>❓ Help</strong> to see how.';
      box.appendChild(p);
    }
    for (const rec of mine) {
      const url = URL.createObjectURL(rec.blob);
      trayUrls.push(url);
      const tile = flowerTile(url, 'My flower', { kind: 'mine', id: rec.id });
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'tray-remove';
      rm.textContent = '✕';
      rm.setAttribute('aria-label', 'Remove from My flowers');
      rm.addEventListener('click', async e => {
        e.stopPropagation();
        const sure = await dialog({
          title: 'Remove this flower?',
          body: '<p>It will be taken out of <strong>My flowers</strong>. Arrangements that already use it will keep it.</p>',
          buttons: [{ label: 'Yes, remove', value: true, style: 'danger' }, { label: 'No', value: false }],
        });
        if (sure) { await db.removeMyFlower(rec.id); setTab('mine'); }
      });
      tile.appendChild(rm);
      box.appendChild(tile);
    }
    return;
  }

  const list = libraryFor(cat);
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'tray-empty';
    p.textContent = 'No pictures here yet. Use ⭐ My flowers to add your own.';
    box.appendChild(p);
  }
  for (const f of list) box.appendChild(flowerTile(f.file, f.name, { kind: 'lib', id: f.id }));
}

function actionTile(icon, label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tray-item tray-action';
  b.innerHTML = `<span class="big" aria-hidden="true">${icon}</span><span class="label">${label}</span>`;
  b.addEventListener('click', onClick);
  return b;
}

function flowerTile(imgUrl, name, src) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tray-item';
  b.innerHTML = `<img src="${imgUrl}" alt="" loading="lazy"><span class="label">${escapeHtml(name)}</span>`;
  b.setAttribute('aria-label', 'Add ' + name);
  b.addEventListener('click', async () => {
    try {
      await editor.addItem(src, src.kind === 'lib' ? currentTab : 'flowers');
    } catch (err) {
      console.error(err);
      toast('Sorry, that picture could not be added');
    }
  });
  return b;
}

// ---------------------------------------------------------------- your own flowers

async function pasteFlower() {
  try {
    const blob = await readClipboardImage();
    await addCutout(blob);
  } catch (err) {
    console.warn(err);
    if (err.code === 'denied') {
      await dialog({
        title: 'Paste was not allowed',
        body: '<p>Your phone asked whether this app may paste. Please tap <strong>Paste</strong> or <strong>Allow</strong> when it asks.</p>' +
          '<p>Or use <strong>🖼️ Photos</strong> (in ⭐ My flowers) instead.</p>',
        buttons: [{ label: 'OK', value: true, style: 'primary' }],
      });
    } else if (err.code === 'unsupported') {
      await dialog({
        title: 'Paste does not work here',
        body: '<p>This browser cannot paste pictures. Please save the flower to your photos first, then use <strong>🖼️ Photos</strong> (in ⭐ My flowers).</p>',
        buttons: [{ label: 'OK', value: true, style: 'primary' }],
      });
    } else {
      await dialog({
        title: 'Nothing to paste yet',
        body: pasteHowToHtml(),
        buttons: [{ label: 'OK', value: true, style: 'primary' }],
      });
    }
  }
}

function pasteHowToHtml() {
  return `<p>First copy a flower from one of your photos:</p>
    <ul>
      <li><strong>iPhone / iPad:</strong> open the photo in <em>Photos</em>, press and hold on the flower until it glows, then tap <strong>Copy</strong>.</li>
      <li><strong>Android:</strong> open the photo in <em>Gallery</em> or <em>Google Photos</em>, press and hold on the flower, then tap <strong>Copy</strong>.</li>
    </ul>
    <p>Then come back here and tap <strong>📋 Paste</strong>.</p>`;
}

async function addCutout(blob) {
  busy(true);
  try {
    const png = await prepareCutout(blob);
    const rec = await db.putImage('mine', png);
    db.requestPersistence();
    await editor.addItem({ kind: 'mine', id: rec.id });
    await setTab('mine');
    toast('Added — it is also kept in ⭐ My flowers');
  } catch (err) {
    console.error(err);
    toast('Sorry, that picture could not be used');
  } finally {
    busy(false);
  }
}

// ---------------------------------------------------------------- save picture

async function exportPicture() {
  if (!current) return;
  editor.select(null);
  busy(true);
  let blob;
  try {
    await flushSave();
    blob = await canvasToBlob(editor.renderToCanvas(1), 'image/jpeg', 0.92);
  } catch (err) {
    console.error(err);
    busy(false);
    toast('Sorry, the picture could not be made');
    return;
  }
  busy(false);

  const fileName = (current.name.replace(/[^\w\- ]+/g, '').trim() || 'flower-idea') + '.jpg';
  const file = new File([blob], fileName, { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));

  const download = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Saved to your Downloads');
  };
  const share = async () => {
    try {
      await navigator.share({ files: [file], title: current ? current.name : 'Flower idea' });
    } catch (err) {
      if (err.name !== 'AbortError') toast('Could not open sharing');
    }
  };

  const buttons = [];
  if (isIOS && canShare) {
    buttons.push({ label: '📥 Save to Photos', style: 'primary', onClick: share });
  } else {
    buttons.push({ label: '📥 Save to my phone', style: 'primary', onClick: download });
    if (canShare) buttons.push({ label: '📤 Send / Share', onClick: share });
  }
  buttons.push({ label: 'Close', value: null });

  const tip = isIOS
    ? 'Tap <strong>Save to Photos</strong>, then choose <strong>Save Image</strong>. Or press and hold the picture.'
    : 'The picture will appear in your Gallery (in the Downloads album).';
  await dialog({
    title: 'Your picture is ready',
    body: `<img class="export-preview" src="${url}" alt="Your arrangement"><p class="small-note">${tip}</p>`,
    buttons,
    stacked: true,
  });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---------------------------------------------------------------- help

const HELP_PAGES = [
  {
    emoji: '⛪📷',
    title: 'Welcome!',
    html: `<p>Try out flower ideas before you make them.</p>
      <ul>
        <li>Tap <strong>➕ New arrangement</strong>.</li>
        <li>Take a photo of the place in church (the altar, a stand, a window), or choose one you already have.</li>
      </ul>`,
  },
  {
    emoji: '🌹👆',
    title: 'Add flowers',
    html: `<ul>
        <li>At the bottom are the flowers. Slide left and right to see more.</li>
        <li><strong>Tap a flower</strong> and it appears in the middle of your photo.</li>
        <li>The tabs show <strong>Flowers</strong>, <strong>Greenery</strong>, <strong>Vases</strong> and <strong>My flowers</strong>.</li>
      </ul>`,
  },
  {
    emoji: '✋🔄',
    title: 'Move and change',
    html: `<ul>
        <li><strong>Tap</strong> a flower in the picture to choose it. <strong>Drag</strong> it with one finger.</li>
        <li>Use two fingers to make it bigger, smaller or to turn it — or use the big buttons: <strong>Bigger</strong>, <strong>Smaller</strong>, <strong>Turn</strong>, <strong>Front</strong>, <strong>Back</strong>, <strong>Remove</strong>.</li>
        <li>Made a mistake? Tap <strong>↶ Undo</strong> at the top.</li>
      </ul>`,
  },
  {
    emoji: '⭐📋',
    title: 'Use your own flowers',
    html: pasteHowToHtml().replace('Then come back here and tap', 'Then open <strong>⭐ My flowers</strong> here and tap') +
      '<p>Your flower is kept in <strong>⭐ My flowers</strong> for next time.</p>',
  },
  {
    emoji: '💾🖼️',
    title: 'Saving',
    html: `<ul>
        <li>Everything is <strong>saved by itself</strong>. Tap <strong>← Done</strong> to go back to your list.</li>
        <li>Tap <strong>💾 Save picture</strong> to keep a photo of your idea or send it to family.</li>
      </ul>`,
  },
];
let helpPage = 0;

function openHelp(page = 0) {
  helpPage = page;
  renderHelp();
  $('#help').hidden = false;
  $('#help-next').focus();
}

function renderHelp() {
  const p = HELP_PAGES[helpPage];
  $('#help-pages').innerHTML = `<div class="help-page">
      <div class="help-emoji" aria-hidden="true">${p.emoji}</div>
      <h2 id="help-heading">${p.title}</h2>
      ${p.html}
    </div>`;
  $('#help-dots').innerHTML = HELP_PAGES.map((_, i) => `<span class="${i === helpPage ? 'on' : ''}"></span>`).join('');
  $('#help-prev').style.visibility = helpPage === 0 ? 'hidden' : 'visible';
  $('#help-next').textContent = helpPage === HELP_PAGES.length - 1 ? 'Got it ✔' : 'Next →';
}

function setupHelp() {
  $$('[data-action="help"]').forEach(b => b.addEventListener('click', () => openHelp(0)));
  $('#help-prev').addEventListener('click', () => { if (helpPage > 0) { helpPage--; renderHelp(); } });
  $('#help-next').addEventListener('click', () => {
    if (helpPage < HELP_PAGES.length - 1) { helpPage++; renderHelp(); }
    else $('#help').hidden = true;
  });
}

// ---------------------------------------------------------------- start

async function start() {
  await loadLibrary();
  setupNewScreen();
  setupEditor();
  setupHelp();
  $('#btn-new').addEventListener('click', () => show('new'));
  $$('[data-action="go-home"]').forEach(b => b.addEventListener('click', () => history.back()));

  history.replaceState({ screen: 'home' }, '');
  await renderHome();

  if (!db.getSetting('seen-help')) {
    db.setSetting('seen-help', '1');
    db.setSetting('seen-editor-help', '1');
    openHelp(0);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Offline mode not available', err));
  }
}

start().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin',
    '<p style="padding:16px;background:#fde;">Sorry, the app could not start. Please close it and open it again.</p>');
});
