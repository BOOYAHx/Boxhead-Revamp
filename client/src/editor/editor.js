// The map editor (editor.html): paint the ground, place props, marks and
// spawn points with the game's own art, test the map in Quick Play, and share
// it as a map code (the game's own map format) or a file.

import { TEST_MAP_KEY } from '../config.js';
import { DECALS } from '../game/world.js';
import { ASSET_ROOT } from '../render/assets.js';
import { EXAMPLES } from './examples.js';
import { Art, CELL_HEIGHT, CELL_WIDTH, MapPainter, decalCell, propLook } from './MapPainter.js';
import { MAX_SIZE, MIN_SIZE, MapDoc, decodeMap, encodeMap, footprintOf, parseShared } from './mapCode.js';
import { ERASER, GROUND, GROUND_NAMES, MARKS, PROPS, SPAWN } from './palette.js';

const SAVE_KEY = 'bbh.editor.map'; // the map being edited, kept in this browser
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3];
const HISTORY = 100;
const SPAWN_COLOR = '#35d07f';
const RECOMMENDED_SPAWNS = 8;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};
const PROP_LABELS = new Map(PROPS.flatMap((group) => group.items.map((item) => [`${item.code}:${item.variant}`, item.label])));
const MARK_LABELS = Object.fromEntries(MARKS.map((m) => [m.code, m.label]));

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const slug = (name) => (name || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';

class Editor {
  constructor() {
    this.art = new Art(() => this.artArrived());
    this.painter = new MapPainter(this.art);
    const saved = readStorage(SAVE_KEY);
    try {
      this.doc = saved?.data ? decodeMap(saved.data, saved.name) : null;
    } catch {
      this.doc = null;
    }
    this.doc ||= new MapDoc({ name: 'My Map', width: 40, height: 30, texture: 1 });
    this.tab = 'ground';
    this.tool = GROUND[1];
    this.shape = 'brush';
    this.size = 1;
    this.zoom = 1;
    this.grid = true;
    this.undoStack = [];
    this.redoStack = [];
    this.hover = null; // the cell under the pointer
    this.stroke = null; // the drag in progress
    this.panning = null;
    this.spaceHeld = false;
    this.drawQueued = false;
    this.thumbsQueued = false;
    this.thumbs = []; // [canvas, draw()] for the palette
    this.mapCanvas = $('ed-map');
    this.over = $('ed-over');
    this.view = $('ed-view');
  }

  async start() {
    await this.art.load();
    this.bindToolbar();
    this.bindCanvas();
    this.bindKeys();
    this.showTab('ground');
    this.syncFields();
    this.applyZoom(this.fitZoom());
    this.redraw();
  }

  // --- palette ----------------------------------------------------------------------

  showTab(tab) {
    this.tab = tab;
    for (const button of document.querySelectorAll('.ed-tabs button')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    $('ed-ground-tools').hidden = tab !== 'ground';
    const box = $('ed-items');
    box.replaceChildren();
    this.thumbs = [];
    this.itemButtons = [];
    if (tab === 'ground') {
      box.append(this.itemGrid(GROUND, 'ed-grid ed-wide', (item, canvas) => this.groundThumb(item, canvas), 120, 54));
    } else if (tab === 'marks') {
      for (const mark of MARKS) {
        const items = Array.from({ length: mark.count }, (_, variant) => ({ type: 'mark', code: mark.code, variant, label: mark.label }));
        box.append(el('div', { className: 'ed-group', textContent: mark.label }), this.itemGrid(items, 'ed-grid', (item, canvas) => this.markThumb(item, canvas), 64, 64, false));
      }
    } else if (tab === 'props') {
      for (const group of PROPS) box.append(el('div', { className: 'ed-group', textContent: group.label }), this.itemGrid(group.items, 'ed-grid', (item, canvas) => this.art.propThumbnail(canvas, item.code, item.variant), 64, 64, false));
    } else {
      box.append(this.itemGrid([SPAWN, ERASER], 'ed-grid ed-wide', (item, canvas) => this.otherThumb(item, canvas), 120, 54));
      box.append(el('p', { className: 'ed-help', textContent: `Players start at the spawn points: put at least ${RECOMMENDED_SPAWNS} round the map, away from each other. Spawn points cannot go under props.` }));
    }
    // Keep the chosen tool when it is on this tab; otherwise the first item.
    const here = this.itemButtons.find((b) => b.item === this.tool) || this.itemButtons[0];
    if (here) this.select(here.item);
    this.drawThumbs();
  }

  itemGrid(items, className, draw, w, h, labels = true) {
    const grid = el('div', { className });
    for (const item of items) {
      const canvas = el('canvas', { width: w, height: h });
      const button = el('button', { type: 'button', className: 'ed-item', title: item.label }, canvas, labels ? el('span', { className: 'ed-item-label', textContent: item.label }) : null);
      button.item = item;
      button.addEventListener('click', () => this.select(item));
      grid.append(button);
      this.itemButtons.push(button);
      this.thumbs.push(() => draw(item, canvas));
    }
    return grid;
  }

  select(item) {
    this.tool = item;
    for (const b of this.itemButtons) b.setAttribute('aria-pressed', String(b.item === item));
    this.drawOverlay();
  }

  drawThumbs() {
    for (const draw of this.thumbs) draw();
  }

  groundThumb(item, canvas) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#' + this.doc.background.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const texture = this.art.image(item.image);
    if (!texture) return;
    for (let y = 0; y < canvas.height; y += texture.height) for (let x = 0; x < canvas.width; x += texture.width) ctx.drawImage(texture, x, y);
  }

  markThumb(item, canvas) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#55585b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sheet = this.art.image(DECALS[item.code]);
    if (!sheet) return;
    const [sx, sy] = decalCell(sheet.width, sheet.height, item.variant);
    const k = Math.min(canvas.width / CELL_WIDTH, canvas.height / CELL_HEIGHT);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, sx, sy, CELL_WIDTH, CELL_HEIGHT, (canvas.width - CELL_WIDTH * k) / 2, (canvas.height - CELL_HEIGHT * k) / 2, CELL_WIDTH * k, CELL_HEIGHT * k);
  }

  otherThumb(item, canvas) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2a2420';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (item === SPAWN) this.drawSpawn(ctx, canvas.width / 2, canvas.height / 2 - 4, 1.4);
    else {
      ctx.strokeStyle = '#ff5a4a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 - 12, canvas.height / 2 - 16);
      ctx.lineTo(canvas.width / 2 + 12, canvas.height / 2 + 8);
      ctx.moveTo(canvas.width / 2 + 12, canvas.height / 2 - 16);
      ctx.lineTo(canvas.width / 2 - 12, canvas.height / 2 + 8);
      ctx.stroke();
    }
  }

  artArrived() {
    this.redraw();
    if (this.thumbsQueued) return;
    this.thumbsQueued = true;
    requestAnimationFrame(() => {
      this.thumbsQueued = false;
      this.drawThumbs();
    });
  }

  // --- toolbar ----------------------------------------------------------------------

  bindToolbar() {
    for (const button of document.querySelectorAll('.ed-tabs button')) button.addEventListener('click', () => this.showTab(button.dataset.tab));
    for (const button of document.querySelectorAll('#ed-shape button')) {
      button.addEventListener('click', () => {
        this.shape = button.dataset.shape;
        for (const b of document.querySelectorAll('#ed-shape button')) b.setAttribute('aria-pressed', String(b === button));
      });
    }
    for (const button of document.querySelectorAll('#ed-brush button')) button.addEventListener('click', () => this.setBrush(Number(button.dataset.size)));
    $('ed-name').addEventListener('input', () => {
      this.doc.name = $('ed-name').value.trim() || 'My Map';
      this.save();
    });
    $('ed-settings').addEventListener('click', () => this.settingsDialog());
    $('ed-new').addEventListener('click', () => this.newDialog());
    $('ed-open').addEventListener('click', () => this.openDialog());
    $('ed-undo').addEventListener('click', () => this.undo());
    $('ed-redo').addEventListener('click', () => this.redo());
    $('ed-grid').addEventListener('click', () => this.toggleGrid());
    $('ed-zoom-in').addEventListener('click', () => this.stepZoom(1));
    $('ed-zoom-out').addEventListener('click', () => this.stepZoom(-1));
    $('ed-test').addEventListener('click', () => this.testPlay());
    $('ed-share').addEventListener('click', () => this.shareDialog());
  }

  setBrush(size) {
    this.size = size;
    for (const b of document.querySelectorAll('#ed-brush button')) b.setAttribute('aria-pressed', String(Number(b.dataset.size) === size));
    this.drawOverlay();
  }

  syncFields() {
    const d = this.doc;
    $('ed-name').value = d.name;
    $('ed-undo').disabled = !this.undoStack.length;
    $('ed-redo').disabled = !this.redoStack.length;
  }

  // --- editing and history -------------------------------------------------------------

  snapshot() {
    return { name: this.doc.name, data: encodeMap(this.doc) };
  }

  /** Remember the map as it is now, before a change. */
  remember(before = this.snapshot()) {
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.syncFields();
  }

  /** One undoable change: change() returns whether something changed. */
  edit(change, always = false) {
    const before = this.snapshot();
    const changed = change();
    if (changed || always) {
      this.remember(before);
      this.changed();
    }
  }

  changed() {
    this.save();
    this.redraw();
    this.updateStatus();
  }

  load(doc, { remember = true } = {}) {
    if (remember) this.remember();
    this.doc = doc;
    this.syncFields();
    this.changed();
    this.drawThumbs();
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.snapshot());
    this.doc = decodeMap(previous.data, previous.name);
    this.syncFields();
    this.changed();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.doc = decodeMap(next.data, next.name);
    this.syncFields();
    this.changed();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => writeStorage(SAVE_KEY, this.snapshot()), 300);
  }

  /** The map's size, background colour (the bare ground) and shading. */
  settingsDialog() {
    const d = this.doc;
    const width = el('input', { type: 'number', min: MIN_SIZE, max: MAX_SIZE, value: d.width });
    const height = el('input', { type: 'number', min: MIN_SIZE, max: MAX_SIZE, value: d.height });
    const background = el('input', { type: 'color', value: '#' + d.background.toString(16).padStart(6, '0') });
    const relief = el('select', {}, ...[['-1', 'None'], ['0', 'Clouds 1'], ['1', 'Clouds 2'], ['2', 'Clouds 3']].map(([value, text]) => el('option', { value, textContent: text, selected: Number(value) === d.relief })));
    const note = el('p', { className: 'ed-note' });
    this.dialog('Map settings', [
      el('p', { textContent: `Size: ${MIN_SIZE} to ${MAX_SIZE} cells each way. Making the map smaller cuts off the right and bottom edges.` }),
      el('label', { className: 'ed-field' }, 'Size ', width, ' × ', height),
      el('label', { className: 'ed-field' }, 'Background colour (the bare ground) ', background),
      el('label', { className: 'ed-field' }, 'Shading over the ground ', relief),
      note,
    ], [
      { label: 'Cancel' },
      {
        label: 'Apply',
        primary: true,
        run: () => {
          const w = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.trunc(Number(width.value)) || d.width));
          const h = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.trunc(Number(height.value)) || d.height));
          const next = w === d.width && h === d.height ? d.clone() : d.resized(w, h);
          const lost = d.props.length - next.props.length + d.spawns.size - next.spawns.size;
          if (lost > 0 && note.dataset.warned !== `${w}x${h}`) {
            note.dataset.warned = `${w}x${h}`;
            note.textContent = `That removes ${lost} prop${lost === 1 ? '' : 's'} or spawn point${lost === 1 ? '' : 's'} past the new edge. Press Apply again to go ahead.`;
            return false;
          }
          next.background = parseInt(background.value.slice(1), 16);
          next.relief = Number(relief.value);
          this.load(next);
          this.applyZoom(this.zoom);
        },
      },
    ]);
  }

  // --- the map view --------------------------------------------------------------------

  fitZoom() {
    const w = this.view.clientWidth - 48;
    const h = this.view.clientHeight - 48;
    const fit = Math.min(w / (this.doc.width * CELL_WIDTH), h / (this.doc.height * CELL_HEIGHT));
    return ZOOMS.filter((z) => z <= Math.max(fit, ZOOMS[0])).pop() || ZOOMS[0];
  }

  applyZoom(zoom, anchor = null) {
    const view = this.view;
    const before = anchor && { x: (view.scrollLeft + anchor.x) / this.zoom, y: (view.scrollTop + anchor.y) / this.zoom };
    this.zoom = zoom;
    const w = this.doc.width * CELL_WIDTH * zoom;
    const h = this.doc.height * CELL_HEIGHT * zoom;
    for (const canvas of [this.mapCanvas, this.over]) {
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    $('ed-canvas').classList.toggle('is-zoomed', zoom > 1);
    $('ed-zoom').textContent = Math.round(zoom * 100) + '%';
    if (before) {
      view.scrollLeft = before.x * zoom - anchor.x;
      view.scrollTop = before.y * zoom - anchor.y;
    }
  }

  stepZoom(direction, anchor = null) {
    const i = ZOOMS.indexOf(this.zoom);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 5 : i) + direction))];
    if (next !== this.zoom) this.applyZoom(next, anchor);
  }

  toggleGrid() {
    this.grid = !this.grid;
    $('ed-grid').setAttribute('aria-pressed', String(this.grid));
    this.drawOverlay();
  }

  redraw() {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      const sized = this.mapCanvas.width !== this.doc.width * CELL_WIDTH || this.mapCanvas.height !== this.doc.height * CELL_HEIGHT;
      this.painter.draw(this.mapCanvas, this.doc);
      if (sized) this.applyZoom(this.zoom);
      this.drawOverlay();
      this.updateStatus();
    });
  }

  drawOverlay() {
    const { doc, over } = this;
    const W = doc.width * CELL_WIDTH;
    const H = doc.height * CELL_HEIGHT;
    if (over.width !== W || over.height !== H) {
      over.width = W;
      over.height = H;
    }
    const ctx = over.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (this.grid) {
      ctx.lineWidth = 1;
      for (let x = 0; x <= doc.width; x++) {
        ctx.strokeStyle = x % 10 === 0 ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.11)';
        ctx.beginPath();
        ctx.moveTo(x * CELL_WIDTH + 0.5, 0);
        ctx.lineTo(x * CELL_WIDTH + 0.5, H);
        ctx.stroke();
      }
      for (let y = 0; y <= doc.height; y++) {
        ctx.strokeStyle = y % 10 === 0 ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.11)';
        ctx.beginPath();
        ctx.moveTo(0, y * CELL_HEIGHT + 0.5);
        ctx.lineTo(W, y * CELL_HEIGHT + 0.5);
        ctx.stroke();
      }
    }
    for (const { x, y } of doc.spawnPoints()) this.drawSpawn(ctx, (x + 0.5) * CELL_WIDTH, (y + 0.5) * CELL_HEIGHT);
    this.drawGhost(ctx);
  }

  drawSpawn(ctx, cx, cy, k = 1) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 9, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = SPAWN_COLOR;
    ctx.strokeStyle = '#0b2e1a';
    ctx.lineWidth = 2;
    ctx.beginPath(); // a map pin
    ctx.arc(0, -4, 8, Math.PI, 0);
    ctx.lineTo(0, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, -4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** What would happen at the cell under the pointer: the prop's ghost, the brush, the box. */
  drawGhost(ctx) {
    const cell = this.hover;
    const box = (x, y, w, h, color) => {
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.strokeRect(x * CELL_WIDTH + 1, y * CELL_HEIGHT + 1, w * CELL_WIDTH - 2, h * CELL_HEIGHT - 2);
    };
    if (this.stroke?.rect) {
      const r = this.rectOf(this.stroke.start, this.stroke.end);
      box(r.x0, r.y0, r.x1 - r.x0 + 1, r.y1 - r.y0 + 1, '#ffd166');
      return;
    }
    if (!cell) return;
    const tool = this.tool;
    if (tool.type === 'prop') {
      const look = propLook(tool.code, tool.variant);
      const ok = this.doc.canPlace(tool.code, tool.variant, cell.x, cell.y);
      if (look?.display) {
        ctx.save();
        ctx.globalAlpha = ok ? 0.75 : 0.35;
        this.art.drawSprite(ctx, look.display, Math.round((cell.x + look.width / 2) * CELL_WIDTH), Math.round((cell.y + look.height / 2) * CELL_HEIGHT));
        ctx.restore();
      }
      box(cell.x, cell.y, look?.width || 1, look?.height || 1, ok ? '#7CFC9A' : '#ff5a4a');
    } else if (tool.type === 'ground' && this.shape === 'brush') {
      const s = this.brushOrigin(cell);
      box(s.x, s.y, this.size, this.size, '#ffd166');
    } else if (tool.type === 'erase') {
      const prop = this.doc.propAt(cell.x, cell.y);
      if (prop) {
        const [w, h] = footprintOf(prop.code, prop.variant);
        box(prop.x, prop.y, w, h, '#ff5a4a');
      } else box(cell.x, cell.y, 1, 1, '#ff5a4a');
    } else {
      const ok = tool.type !== 'spawn' || this.doc.canSpawn(cell.x, cell.y);
      box(cell.x, cell.y, 1, 1, ok ? '#ffd166' : '#ff5a4a');
    }
  }

  // --- pointer ----------------------------------------------------------------------

  cellAt(event) {
    const r = this.over.getBoundingClientRect();
    const x = Math.floor(((event.clientX - r.left) / r.width) * this.doc.width);
    const y = Math.floor(((event.clientY - r.top) / r.height) * this.doc.height);
    return this.doc.inside(x, y) ? { x, y } : null;
  }

  bindCanvas() {
    const over = this.over;
    over.addEventListener('contextmenu', (e) => e.preventDefault());
    over.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || (e.button === 0 && this.spaceHeld)) return this.startPan(e);
      const cell = this.cellAt(e);
      if (!cell || (e.button !== 0 && e.button !== 2)) return;
      over.setPointerCapture(e.pointerId);
      const erase = e.button === 2 || this.tool.type === 'erase';
      this.stroke = { before: this.snapshot(), changed: false, erase, last: null, start: cell, end: cell, rect: !erase && this.tool.type === 'ground' && this.shape === 'rect' };
      if (!erase && this.tool.type === 'ground' && this.shape === 'fill') this.stroke.changed = this.floodFill(cell, this.tool.texture);
      else if (!this.stroke.rect) this.applyAt(cell, true);
      this.afterStep();
    });
    over.addEventListener('pointermove', (e) => {
      if (this.panning) return this.pan(e);
      const cell = this.cellAt(e);
      const moved = cell?.x !== this.hover?.x || cell?.y !== this.hover?.y;
      this.hover = cell;
      if (this.stroke && cell && moved) {
        if (this.stroke.rect) this.stroke.end = cell;
        else if (!(this.tool.type === 'ground' && this.shape === 'fill')) this.applyAt(cell, false);
        this.afterStep();
      }
      if (moved) {
        this.drawOverlay();
        this.updateStatus();
      }
    });
    const end = () => {
      if (this.panning) return this.endPan();
      const stroke = this.stroke;
      if (!stroke) return;
      if (stroke.rect) stroke.changed = this.fillRect(stroke.start, stroke.end, this.tool.texture) || stroke.changed;
      this.stroke = null;
      if (stroke.changed) {
        this.remember(stroke.before);
        this.changed();
      }
      this.drawOverlay();
    };
    over.addEventListener('pointerup', end);
    over.addEventListener('pointercancel', end);
    over.addEventListener('pointerleave', () => {
      if (this.stroke) return;
      this.hover = null;
      this.drawOverlay();
      this.updateStatus();
    });
    this.view.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const r = this.view.getBoundingClientRect();
        this.stepZoom(e.deltaY < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top });
      },
      { passive: false },
    );
  }

  startPan(e) {
    e.preventDefault();
    this.over.setPointerCapture(e.pointerId);
    this.panning = { x: e.clientX, y: e.clientY, left: this.view.scrollLeft, top: this.view.scrollTop };
    this.view.classList.add('is-panning');
  }

  pan(e) {
    const p = this.panning;
    this.view.scrollLeft = p.left - (e.clientX - p.x);
    this.view.scrollTop = p.top - (e.clientY - p.y);
  }

  endPan() {
    this.panning = null;
    this.view.classList.remove('is-panning');
  }

  afterStep() {
    if (this.stroke?.changed) this.redraw();
    else this.drawOverlay();
  }

  brushOrigin(cell) {
    const back = Math.floor((this.size - 1) / 2);
    return { x: cell.x - back, y: cell.y - back };
  }

  /** The tool's work at one cell of a drag (first: the press itself). */
  applyAt(cell, first) {
    const { doc, tool, stroke } = this;
    let changed = false;
    if (stroke.erase) changed = this.eraseAt(cell, first);
    else if (tool.type === 'ground') {
      const o = this.brushOrigin(cell);
      for (let j = 0; j < this.size; j++) for (let i = 0; i < this.size; i++) changed = doc.setTexture(o.x + i, o.y + j, tool.texture) || changed;
    } else if (tool.type === 'mark') changed = doc.setDecal(cell.x, cell.y, tool.code, tool.variant);
    else if (tool.type === 'prop') changed = !!doc.place(tool.code, tool.variant, cell.x, cell.y);
    else if (tool.type === 'spawn') {
      // A click on a spawn point takes it away; a drag only adds.
      if (first && doc.spawns.has(doc.index(cell.x, cell.y))) {
        changed = doc.removeSpawn(cell.x, cell.y);
        stroke.removing = true;
      } else if (!stroke.removing) changed = doc.setSpawn(cell.x, cell.y);
    }
    stroke.changed ||= changed;
  }

  /** Right click / the eraser: the spawn point, else the prop, else the mark at the cell. */
  eraseAt(cell) {
    const doc = this.doc;
    if (doc.removeSpawn(cell.x, cell.y)) return true;
    const prop = doc.propAt(cell.x, cell.y);
    if (prop) return doc.removeProp(prop);
    return doc.removeDecal(cell.x, cell.y);
  }

  rectOf(a, b) {
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  }

  fillRect(a, b, texture) {
    const r = this.rectOf(a, b);
    let changed = false;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) changed = this.doc.setTexture(x, y, texture) || changed;
    return changed;
  }

  /** The bucket: every touching cell of the same ground. */
  floodFill(cell, texture) {
    const doc = this.doc;
    const from = doc.textureAt(cell.x, cell.y);
    if (from === texture) return false;
    const stack = [[cell.x, cell.y]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (!doc.inside(x, y) || doc.textureAt(x, y) !== from) continue;
      doc.setTexture(x, y, texture);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return true;
  }

  // --- keys -----------------------------------------------------------------------------

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || $('ed-dialog').open;
      if (typing) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === ' ') {
        e.preventDefault();
        this.spaceHeld = true;
        this.view.classList.add('is-panning');
      } else if (!ctrl && e.key.toLowerCase() === 'g') this.toggleGrid();
      else if (!ctrl && (e.key === '+' || e.key === '=')) this.stepZoom(1);
      else if (!ctrl && e.key === '-') this.stepZoom(-1);
      else if (!ctrl && e.key.toLowerCase() === 'e') {
        this.tool = ERASER;
        this.showTab('other');
      }
      else if (!ctrl && e.key === '[') this.setBrush([1, 2, 3, 5][Math.max(0, [1, 2, 3, 5].indexOf(this.size) - 1)]);
      else if (!ctrl && e.key === ']') this.setBrush([1, 2, 3, 5][Math.min(3, [1, 2, 3, 5].indexOf(this.size) + 1)]);
    });
    window.addEventListener('keyup', (e) => {
      if (e.key !== ' ') return;
      this.spaceHeld = false;
      if (!this.panning) this.view.classList.remove('is-panning');
    });
  }

  // --- status ---------------------------------------------------------------------------

  updateStatus() {
    const doc = this.doc;
    const cell = this.hover;
    let where = '';
    if (cell) {
      const parts = [`x ${cell.x}, y ${cell.y}`, GROUND_NAMES[doc.textureAt(cell.x, cell.y)]];
      const decal = doc.decals.get(doc.index(cell.x, cell.y));
      if (decal) parts.push(MARK_LABELS[decal.code] || 'mark');
      const prop = doc.propAt(cell.x, cell.y);
      if (prop) parts.push(PROP_LABELS.get(`${prop.code}:${prop.variant}`) || 'prop');
      if (doc.spawns.has(doc.index(cell.x, cell.y))) parts.push('spawn point');
      where = parts.join(' · ');
    }
    $('ed-where').textContent = where;
    const spawns = doc.spawns.size;
    const info = $('ed-info');
    info.replaceChildren(`${doc.width} × ${doc.height} cells · ${doc.props.length} props · `, el('span', { className: spawns < RECOMMENDED_SPAWNS ? 'is-warning' : '', textContent: spawns === 0 ? 'no spawn points yet (players need some)' : `${spawns} spawn point${spawns === 1 ? '' : 's'}${spawns < RECOMMENDED_SPAWNS ? ` (${RECOMMENDED_SPAWNS} or more is best)` : ''}` }));
  }

  // --- dialogs ----------------------------------------------------------------------------

  dialog(title, body, actions) {
    const dialog = $('ed-dialog');
    $('ed-dialog-title').textContent = title;
    $('ed-dialog-body').replaceChildren(...body);
    $('ed-dialog-actions').replaceChildren(
      ...actions.map(({ label, primary, run }) => {
        const button = el('button', { type: run ? 'button' : 'submit', className: 'ed-btn' + (primary ? ' ed-primary' : ''), textContent: label });
        if (run) button.addEventListener('click', () => run() !== false && dialog.close());
        return button;
      }),
    );
    dialog.showModal();
  }

  newDialog() {
    const name = el('input', { value: 'My Map', maxLength: 24 });
    const width = el('input', { type: 'number', min: MIN_SIZE, max: MAX_SIZE, value: 40 });
    const height = el('input', { type: 'number', min: MIN_SIZE, max: MAX_SIZE, value: 30 });
    const ground = el('select', {}, ...GROUND.map((g) => el('option', { value: g.texture, textContent: g.label, selected: g.texture === 1 })));
    this.dialog('New map', [
      el('p', { textContent: `Maps are ${MIN_SIZE} to ${MAX_SIZE} cells each way (a cell is about one character wide). The game's maps are 40 x 25 to 80 x 40.` }),
      el('label', { className: 'ed-field' }, 'Name ', name),
      el('label', { className: 'ed-field' }, 'Size ', width, ' × ', height),
      el('label', { className: 'ed-field' }, 'Ground ', ground),
    ], [
      { label: 'Cancel' },
      { label: 'Create', primary: true, run: () => this.load(new MapDoc({ name: name.value.trim() || 'My Map', width: Number(width.value), height: Number(height.value), texture: Number(ground.value), relief: 0 })) },
    ]);
  }

  async openDialog() {
    const note = el('p', { className: 'ed-note' });
    const open = (doc) => {
      this.load(doc);
      this.applyZoom(this.fitZoom());
      $('ed-dialog').close();
    };
    const mapButton = (name, small, data) => {
      const button = el('button', { type: 'button', className: 'ed-btn' }, name, el('small', { textContent: small }));
      button.addEventListener('click', () => {
        try {
          open(decodeMap(data, name));
        } catch (error) {
          note.textContent = error.message;
        }
      });
      return button;
    };
    const gameMaps = el('div', { className: 'ed-maps' }, el('small', { textContent: 'Loading…' }));
    const file = el('input', { type: 'file', accept: '.json,.txt,application/json,text/plain' });
    file.addEventListener('change', async () => {
      try {
        if (file.files[0]) open(parseShared(await file.files[0].text()));
      } catch (error) {
        note.textContent = 'That file has no map in it: ' + error.message;
      }
    });
    const code = el('textarea', { placeholder: 'Paste a map code here (it starts with 1, like 140;30;…)' });
    this.dialog('Open a map', [
      el('p', { textContent: 'Start from one of the game\'s maps or an example (you edit a copy), open a map file, or paste a map code.' }),
      el('div', { className: 'ed-group', textContent: 'The game\'s maps' }),
      gameMaps,
      el('div', { className: 'ed-group', textContent: 'Examples' }),
      el('div', { className: 'ed-maps' }, ...EXAMPLES.map((e) => mapButton(e.name, e.note, e.data))),
      el('div', { className: 'ed-group', textContent: 'A map file' }),
      el('label', { className: 'ed-field' }, file),
      el('div', { className: 'ed-group', textContent: 'A map code' }),
      code,
      note,
    ], [
      { label: 'Cancel' },
      {
        label: 'Open the code',
        primary: true,
        run: () => {
          try {
            open(parseShared(code.value));
          } catch (error) {
            note.textContent = error.message;
            return false;
          }
        },
      },
    ]);
    try {
      const response = await fetch(ASSET_ROOT + 'maps/maps.json', { cache: 'no-store' });
      const list = (await response.json()).filter((m) => m?.data);
      gameMaps.replaceChildren(...list.map((m) => {
        const [w, h] = m.data.substr(1).split(';');
        return mapButton(m.name, `${w} x ${h}`, m.data);
      }));
    } catch {
      gameMaps.replaceChildren(el('small', { textContent: 'The game\'s maps could not be loaded.' }));
    }
  }

  shareDialog() {
    const data = encodeMap(this.doc);
    const text = el('textarea', { readOnly: true, value: data });
    const note = el('p', { className: 'ed-note' });
    const spawns = this.doc.spawns.size;
    this.dialog('Share your map', [
      el('p', { textContent: 'This code is your whole map. Copy it and paste it in a message to send it, or download it as a file (you can open the file here again to keep working on it).' }),
      spawns < RECOMMENDED_SPAWNS ? el('p', { className: 'ed-note', textContent: spawns ? `Only ${spawns} spawn point${spawns === 1 ? '' : 's'}: ${RECOMMENDED_SPAWNS} or more is best.` : 'No spawn points yet: players need some.' }) : null,
      text,
      note,
    ].filter(Boolean), [
      { label: 'Close' },
      {
        label: 'Download file',
        run: () => {
          const blob = new Blob([JSON.stringify({ name: this.doc.name, data }, null, 1)], { type: 'application/json' });
          const a = el('a', { href: URL.createObjectURL(blob), download: slug(this.doc.name) + '.boxhead-map.json' });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
          return false;
        },
      },
      {
        label: 'Copy code',
        primary: true,
        run: () => {
          const done = () => (note.textContent = 'Copied! Paste it in your message.');
          text.select();
          if (navigator.clipboard?.writeText) navigator.clipboard.writeText(data).then(done, () => document.execCommand('copy') && done());
          else if (document.execCommand('copy')) done();
          return false;
        },
      },
    ]);
    text.focus();
    text.select();
  }

  /** Quick Play on this map, in a new tab (play.html?testmap reads it from this browser). */
  testPlay() {
    if (!writeStorage(TEST_MAP_KEY, this.snapshot())) {
      this.dialog('Test play', [el('p', { textContent: 'This browser blocks saving, so the game cannot get the map. Allow site data (or leave private browsing) and try again.' })], [{ label: 'OK' }]);
      return;
    }
    window.open('play.html?testmap', '_blank');
  }
}

const editor = new Editor();
window.boxheadEditor = editor;
editor.start().catch((error) => {
  console.error(error);
  $('ed-info').textContent = 'The editor could not start: ' + error.message;
});
