// The design canvas: background photo + flower pictures that can be moved,
// resized, turned, flipped and stacked. Works with fingers, a pen or a mouse.

import { loadImage, loadImageFromBlob, analyzeImage, makeCanvas } from './images.js';
import { getImage, newId } from './storage.js';
import { libraryItem } from './library.js';

const MIN_SCALE = 0.03;
const MAX_SCALE = 12;
const STEP_SCALE = 1.15;
const STEP_ROT = Math.PI / 12; // 15°
const HISTORY_LIMIT = 60;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Pictures are shared between arrangements, so keep them once.
const sourceCache = new Map(); // key → Promise<{ img, mask, bounds }>

function srcKey(src) { return src.kind + ':' + src.id; }

export function loadSource(src) {
  const key = srcKey(src);
  if (!sourceCache.has(key)) {
    const p = (async () => {
      let img;
      if (src.kind === 'lib') {
        const entry = libraryItem(src.id);
        if (!entry) throw new Error('Unknown flower ' + src.id);
        img = await loadImage(entry.file);
      } else {
        const rec = await getImage(src.id);
        if (!rec) throw new Error('Missing picture');
        img = await loadImageFromBlob(rec.blob);
      }
      const { mask, bounds } = analyzeImage(img);
      return { img, mask, bounds };
    })();
    p.catch(() => sourceCache.delete(key));
    sourceCache.set(key, p);
  }
  return sourceCache.get(key);
}

export class Editor {
  constructor(canvas, { onChange, onSelect } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange || (() => {});
    this.onSelect = onSelect || (() => {});
    this.design = null;
    this.items = [];
    this.loaded = new Map();     // srcKey → { img, mask, bounds }
    this.bgImg = null;
    this.selected = null;        // uid
    this.pointers = new Map();
    this.gesture = null;
    this.past = [];
    this.future = [];
    this.snapshot = '[]';
    this.view = { s: 1, ox: 0, oy: 0, dpr: 1, cw: 0, ch: 0 };
    this._raf = 0;

    canvas.addEventListener('pointerdown', e => this._down(e));
    canvas.addEventListener('pointermove', e => this._move(e));
    canvas.addEventListener('pointerup', e => this._up(e));
    canvas.addEventListener('pointercancel', e => this._up(e));
    canvas.addEventListener('lostpointercapture', e => { if (this.pointers.has(e.pointerId)) this._up(e); });
    canvas.addEventListener('wheel', e => this._wheel(e), { passive: false });
    // Stop iOS from zooming the page / showing the magnifier.
    canvas.addEventListener('gesturestart', e => e.preventDefault());
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    new ResizeObserver(() => this.fit()).observe(canvas.parentElement);
  }

  // ---------- Opening / closing ----------
  async open(design) {
    this.design = design;
    this.items = design.items.map(it => ({ ...it, src: { ...it.src } }));
    this.selected = null;
    this.past = [];
    this.future = [];
    this.snapshot = JSON.stringify(this.items);
    this.bgImg = null;

    if (design.bg.type === 'photo') {
      const rec = await getImage(design.bg.imageId);
      if (rec) this.bgImg = await loadImageFromBlob(rec.blob);
    }
    await Promise.all(this.items.map(it => this._ensureLoaded(it.src)));
    this.fit();
    this.onSelect(null);
  }

  close() {
    this.design = null;
    this.items = [];
    this.bgImg = null;
    this.selected = null;
    this.pointers.clear();
    this.gesture = null;
  }

  async _ensureLoaded(src) {
    const key = srcKey(src);
    if (this.loaded.has(key)) return this.loaded.get(key);
    try {
      const data = await loadSource(src);
      this.loaded.set(key, data);
      return data;
    } catch (err) {
      console.warn('Could not load', key, err);
      return null;
    }
  }

  get world() { return this.design.world; }

  /** The current arrangement, ready to be saved. */
  getItems() { return this.items.map(it => ({ ...it, src: { ...it.src } })); }

  // ---------- Layout ----------
  fit() {
    const parent = this.canvas.parentElement;
    const cw = parent.clientWidth, ch = parent.clientHeight;
    if (!cw || !ch) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    if (this.design) {
      const { w, h } = this.world;
      const s = Math.min(cw / w, ch / h);
      this.view = { s, ox: (cw - w * s) / 2, oy: (ch - h * s) / 2, dpr, cw, ch };
    }
    this.render();
  }

  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const { s, ox, oy } = this.view;
    return { x: (clientX - r.left - ox) / s, y: (clientY - r.top - oy) / s };
  }

  // ---------- Drawing ----------
  render() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._draw();
    });
  }

  _draw() {
    const ctx = this.ctx;
    const { s, ox, oy, dpr } = this.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.design) return;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    this.drawWorld(ctx);
    // Selection outline in screen pixels so it stays crisp and the same thickness.
    const sel = this.items.find(it => it.uid === this.selected);
    if (sel) this._drawSelection(ctx, sel);
  }

  /** Draw background + flowers in world coordinates onto any 2D context. */
  drawWorld(ctx) {
    const { w, h } = this.world;
    ctx.imageSmoothingQuality = 'high';
    if (this.bgImg) {
      ctx.drawImage(this.bgImg, 0, 0, w, h);
    } else {
      ctx.fillStyle = (this.design.bg && this.design.bg.color) || '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    for (const it of this.items) {
      const data = this.loaded.get(srcKey(it.src));
      if (!data) continue;
      const b = data.bounds;
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(it.rot);
      ctx.scale(it.scale * (it.flip ? -1 : 1), it.scale);
      ctx.drawImage(data.img, -(b.x + b.w / 2), -(b.y + b.h / 2));
      ctx.restore();
    }
  }

  _corners(it) {
    const data = this.loaded.get(srcKey(it.src));
    if (!data) return null;
    const hw = (data.bounds.w / 2) * it.scale, hh = (data.bounds.h / 2) * it.scale;
    const c = Math.cos(it.rot), sn = Math.sin(it.rot);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({
      x: it.x + x * c - y * sn,
      y: it.y + x * sn + y * c,
    }));
  }

  _drawSelection(ctx, it) {
    const pts = this._corners(it);
    if (!pts) return;
    const { s, ox, oy, dpr } = this.view;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scr = pts.map(p => ({ x: ox + p.x * s, y: oy + p.y * s }));
    ctx.beginPath();
    scr.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#b5485d';
    ctx.setLineDash([10, 7]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of scr) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#b5485d';
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Render the whole arrangement to a new canvas, `scale` × world size. */
  renderToCanvas(scale = 1) {
    const { w, h } = this.world;
    const c = makeCanvas(w * scale, h * scale);
    const ctx = c.getContext('2d');
    ctx.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
    this.drawWorld(ctx);
    return c;
  }

  // ---------- Hit testing ----------
  _hit(pt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const data = this.loaded.get(srcKey(it.src));
      if (!data) continue;
      const dx = pt.x - it.x, dy = pt.y - it.y;
      const c = Math.cos(-it.rot), sn = Math.sin(-it.rot);
      let lx = (dx * c - dy * sn) / it.scale;
      const ly = (dx * sn + dy * c) / it.scale;
      if (it.flip) lx = -lx;
      const b = data.bounds;
      // A little extra room around small flowers so they are easy to catch.
      const slack = 14 / (this.view.s * it.scale);
      if (Math.abs(lx) > b.w / 2 + slack || Math.abs(ly) > b.h / 2 + slack) continue;
      // The selected flower can be grabbed anywhere inside its outline.
      if (it.uid === this.selected || !data.mask) return it;
      const m = data.mask;
      const ix = (lx + b.x + b.w / 2) * m.k, iy = (ly + b.y + b.h / 2) * m.k;
      const r = Math.max(2, Math.round(slack * m.k));
      for (let yy = Math.floor(iy) - r; yy <= iy + r; yy++) {
        for (let xx = Math.floor(ix) - r; xx <= ix + r; xx++) {
          if (xx < 0 || yy < 0 || xx >= m.w || yy >= m.h) continue;
          if (m.data[yy * m.w + xx] > 30) return it;
        }
      }
    }
    return null;
  }

  // ---------- Selection ----------
  select(uid) {
    if (this.selected === uid) return;
    this.selected = uid;
    this.render();
    this.onSelect(this.selectedItem());
  }

  selectedItem() { return this.items.find(it => it.uid === this.selected) || null; }

  // ---------- Pointer gestures ----------
  _down(e) {
    if (!this.design) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 1) {
      const hit = this._hit(this.toWorld(e.clientX, e.clientY));
      this.select(hit ? hit.uid : null);
      this._startDrag();
    } else if (this.pointers.size === 2) {
      this._startPinch();
    }
  }

  _startDrag() {
    const it = this.selectedItem();
    const [p] = [...this.pointers.values()];
    if (!it || !p) { this.gesture = null; return; }
    this.gesture = { type: 'drag', start: this.toWorld(p.x, p.y), x0: it.x, y0: it.y, moved: this.gesture?.moved };
  }

  _startPinch() {
    const it = this.selectedItem();
    if (!it) { this.gesture = null; return; }
    const [a, b] = [...this.pointers.values()];
    const wa = this.toWorld(a.x, a.y), wb = this.toWorld(b.x, b.y);
    this.gesture = {
      type: 'pinch',
      d0: Math.hypot(wb.x - wa.x, wb.y - wa.y) || 1,
      a0: Math.atan2(wb.y - wa.y, wb.x - wa.x),
      m0: { x: (wa.x + wb.x) / 2, y: (wa.y + wb.y) / 2 },
      x0: it.x, y0: it.y, s0: it.scale, r0: it.rot,
      moved: this.gesture?.moved,
    };
  }

  _move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture;
    const it = this.selectedItem();
    if (!g || !it) return;

    if (g.type === 'drag' && this.pointers.size === 1) {
      const p = this.toWorld(e.clientX, e.clientY);
      const dx = p.x - g.start.x, dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * this.view.s < 4) return; // ignore tiny wobble on tap
      g.moved = true;
      const { w, h } = this.world;
      it.x = clamp(g.x0 + dx, -w * 0.25, w * 1.25);
      it.y = clamp(g.y0 + dy, -h * 0.25, h * 1.25);
      this.render();
    } else if (g.type === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const wa = this.toWorld(a.x, a.y), wb = this.toWorld(b.x, b.y);
      const d = Math.hypot(wb.x - wa.x, wb.y - wa.y) || 1;
      const ang = Math.atan2(wb.y - wa.y, wb.x - wa.x);
      const m = { x: (wa.x + wb.x) / 2, y: (wa.y + wb.y) / 2 };
      g.moved = true;
      it.scale = clamp(g.s0 * (d / g.d0), MIN_SCALE, MAX_SCALE);
      it.rot = g.r0 + (ang - g.a0);
      it.x = g.x0 + (m.x - g.m0.x);
      it.y = g.y0 + (m.y - g.m0.y);
      this.render();
    }
  }

  _up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (this.pointers.size === 1) {
      // Went from two fingers to one: carry on dragging without a jump.
      this._startDrag();
    } else if (this.pointers.size === 0) {
      const moved = this.gesture && this.gesture.moved;
      this.gesture = null;
      if (moved) this.commit();
    }
  }

  _wheel(e) {
    const it = this.selectedItem();
    if (!it) return;
    e.preventDefault();
    if (e.shiftKey) it.rot += (e.deltaY > 0 ? 1 : -1) * (Math.PI / 36);
    else it.scale = clamp(it.scale * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
    this.render();
    clearTimeout(this._wheelTimer);
    this._wheelTimer = setTimeout(() => this.commit(), 400);
  }

  // ---------- Actions ----------
  /**
   * Add a picture. `kind` is 'flowers' | 'greenery' | 'vases' and decides where it
   * first appears: vases low and large, flowers and greenery above them, spread out.
   */
  async addItem(src, kind = 'flowers') {
    const data = await this._ensureLoaded(src);
    if (!data) throw new Error('Could not load this flower');
    const { w, h } = this.world;
    const b = data.bounds;
    const m = Math.min(w, h);
    // Spread new pictures around so they don't land exactly on top of each other.
    const n = this.items.length;
    const spreadX = [0, -1, 1, -2, 2, -0.5, 0.5, -1.5, 1.5][n % 9] * w * 0.09;
    const spreadY = [0, 1, -1][Math.floor(n / 3) % 3] * h * 0.05;
    let size, x, y;
    if (kind === 'vases') {
      size = m * 0.42; x = w / 2; y = h * 0.72;
    } else if (kind === 'greenery') {
      size = m * 0.38; x = w / 2 + spreadX; y = h * 0.45 + spreadY;
    } else {
      size = m * 0.24; x = w / 2 + spreadX; y = h * 0.4 + spreadY;
    }
    // Tall thin pictures (long stems, slim vases) are measured by height, others by width.
    const tall = b.h > b.w * 1.6;
    const scale = clamp(size * (tall ? 1.6 : 1) / Math.max(b.w, b.h), MIN_SCALE, MAX_SCALE);
    const it = {
      uid: newId(),
      src: { ...src },
      x,
      y,
      scale,
      rot: 0,
      flip: false,
      kind,
    };
    // Stems go into the vase: new flowers and greenery slip in behind any vase.
    const firstVase = kind === 'vases' ? -1 : this.items.findIndex(o => o.kind === 'vases');
    if (firstVase >= 0) this.items.splice(firstVase, 0, it);
    else this.items.push(it);
    this.select(it.uid);
    this.commit();
    return it;
  }

  tool(name) {
    const it = this.selectedItem();
    if (name === 'deselect') { this.select(null); return; }
    if (!it) return;
    const idx = this.items.indexOf(it);
    switch (name) {
      case 'bigger': it.scale = clamp(it.scale * STEP_SCALE, MIN_SCALE, MAX_SCALE); break;
      case 'smaller': it.scale = clamp(it.scale / STEP_SCALE, MIN_SCALE, MAX_SCALE); break;
      case 'rotate-left': it.rot -= STEP_ROT; break;
      case 'rotate-right': it.rot += STEP_ROT; break;
      case 'flip': it.flip = !it.flip; break;
      case 'front':
        if (idx === this.items.length - 1) return 'already-front';
        this.items.splice(idx, 1); this.items.splice(idx + 1, 0, it); break;
      case 'back':
        if (idx === 0) return 'already-back';
        this.items.splice(idx, 1); this.items.splice(idx - 1, 0, it); break;
      case 'copy': {
        const { w } = this.world;
        const copy = { ...it, src: { ...it.src }, uid: newId(), x: it.x + w * 0.05, y: it.y + w * 0.03 };
        this.items.splice(idx + 1, 0, copy);
        this.selected = copy.uid;
        this.onSelect(copy);
        break;
      }
      case 'delete':
        this.items.splice(idx, 1);
        this.selected = null;
        this.onSelect(null);
        break;
      default: return;
    }
    this.render();
    this.commit();
  }

  // ---------- Undo / redo ----------
  commit() {
    const now = JSON.stringify(this.items);
    if (now === this.snapshot) return;
    this.past.push(this.snapshot);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.snapshot = now;
    this.onChange();
  }

  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }

  undo() {
    if (!this.past.length) return;
    this.future.push(this.snapshot);
    this._restore(this.past.pop());
  }

  redo() {
    if (!this.future.length) return;
    this.past.push(this.snapshot);
    this._restore(this.future.pop());
  }

  _restore(json) {
    this.snapshot = json;
    this.items = JSON.parse(json);
    if (!this.items.some(it => it.uid === this.selected)) {
      this.selected = null;
    }
    this.onSelect(this.selectedItem());
    this.render();
    this.onChange();
  }
}
