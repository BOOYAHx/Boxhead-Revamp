// The map editor's document: a map as the editor keeps it (prop codes, not
// game objects) and its conversion to and from the game's map strings
// (MapInfo format "1", read by game/world.js parseMap). No drawing here, so it
// can be tested under Node.

import { DECALS, describeProp } from '../game/world.js';
import { WAREHOUSE_FIXED, WAREHOUSE_ORIGINAL } from '../game/maps.js';
import { turnDecal, turnProp } from './rotation.js';
import { fromAlphaCharacter, fromAlphaNumericCharacter, toAlphaNumericCharacter } from '../util/strings.js';

export const MIN_SIZE = 10;
export const MAX_SIZE = 100;
export const DEFAULT_BACKGROUND = 0xebdcc7;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const DECAL_CODES = Object.fromEntries(Object.entries(DECALS).map(([code, name]) => [name, code]));

/** A prop's footprint in cells, [width, height] (its top-left cell is where it is placed). */
export function footprintOf(code, variant) {
  return describeProp(code, variant)?.footprint || [1, 1];
}

/**
 * A map being edited. Props are anchored at their top-left cell and cover their
 * footprint; spawn points take one free cell. textures: one index per cell
 * into world.js TEXTURES (0: the bare background). relief: 0-2 (Relief1-3) or -1.
 */
export class MapDoc {
  constructor({ name = 'My Map', width = 40, height = 30, background = DEFAULT_BACKGROUND, relief = 0, border = 0, texture = 0 } = {}) {
    this.name = name;
    this.width = clampSize(width);
    this.height = clampSize(height);
    this.background = background;
    this.relief = relief;
    this.border = border;
    this.textures = new Uint8Array(this.width * this.height).fill(texture);
    this.props = []; // { x, y, code, variant }
    this.covers = new Map(); // cell index -> the prop covering it
    this.decals = new Map(); // cell index -> { code, variant }
    this.spawns = new Map(); // cell index -> team (0: anyone)
  }

  index(x, y) {
    return y * this.width + x;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  propAt(x, y) {
    return this.inside(x, y) ? this.covers.get(this.index(x, y)) || null : null;
  }

  /** Whether a prop fits with its top-left cell at (x, y): inside the map, on empty cells. */
  canPlace(code, variant, x, y) {
    const [w, h] = footprintOf(code, variant);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!this.inside(x + i, y + j)) return false;
        const index = this.index(x + i, y + j);
        if (this.covers.has(index) || this.spawns.has(index)) return false;
      }
    }
    return true;
  }

  /**
   * Put a prop down. lenient: the game's own rule when it loads a map (only
   * other props block it; it may hang over the edge or stand on a spawn point).
   */
  place(code, variant, x, y, { lenient = false } = {}) {
    const [w, h] = footprintOf(code, variant);
    if (lenient) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (this.inside(x + i, y + j) && this.covers.has(this.index(x + i, y + j))) return null;
    } else if (!this.canPlace(code, variant, x, y)) return null;
    const prop = { x, y, code, variant };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (this.inside(x + i, y + j)) this.covers.set(this.index(x + i, y + j), prop);
    this.props.push(prop);
    return prop;
  }

  removeProp(prop) {
    const at = this.props.indexOf(prop);
    if (at < 0) return false;
    this.props.splice(at, 1);
    const [w, h] = footprintOf(prop.code, prop.variant);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (this.covers.get(this.index(prop.x + i, prop.y + j)) === prop) this.covers.delete(this.index(prop.x + i, prop.y + j));
    return true;
  }

  setTexture(x, y, texture) {
    if (!this.inside(x, y) || this.textures[this.index(x, y)] === texture) return false;
    this.textures[this.index(x, y)] = texture;
    return true;
  }

  textureAt(x, y) {
    return this.inside(x, y) ? this.textures[this.index(x, y)] : 0;
  }

  /** A road line, curb, crack... painted on the ground; code: a letter from world.js DECALS. */
  setDecal(x, y, code, variant) {
    if (!this.inside(x, y)) return false;
    const old = this.decals.get(this.index(x, y));
    if (old && old.code === code && old.variant === variant) return false;
    this.decals.set(this.index(x, y), { code, variant });
    return true;
  }

  removeDecal(x, y) {
    return this.inside(x, y) && this.decals.delete(this.index(x, y));
  }

  canSpawn(x, y) {
    return this.inside(x, y) && !this.covers.has(this.index(x, y));
  }

  setSpawn(x, y, team = 0, { lenient = false } = {}) {
    if (lenient ? !this.inside(x, y) : !this.canSpawn(x, y)) return false;
    this.spawns.set(this.index(x, y), team);
    return true;
  }

  removeSpawn(x, y) {
    return this.inside(x, y) && this.spawns.delete(this.index(x, y));
  }

  /** The same map at another size: what no longer fits is left out. */
  resized(width, height) {
    const doc = new MapDoc({ name: this.name, width, height, background: this.background, relief: this.relief, border: this.border });
    for (let y = 0; y < Math.min(this.height, doc.height); y++) {
      for (let x = 0; x < Math.min(this.width, doc.width); x++) doc.textures[doc.index(x, y)] = this.textures[this.index(x, y)];
    }
    for (const p of this.props) doc.place(p.code, p.variant, p.x, p.y);
    for (const [i, d] of this.decals) doc.setDecal(i % this.width, Math.floor(i / this.width), d.code, d.variant);
    for (const [i, team] of this.spawns) doc.setSpawn(i % this.width, Math.floor(i / this.width), team);
    return doc;
  }

  clone() {
    return decodeMap(encodeMap(this), this.name);
  }

  spawnPoints() {
    return [...this.spawns.keys()].map((i) => ({ x: i % this.width, y: Math.floor(i / this.width) }));
  }

  // --- selections: { props: Set of props, spawns: Set of cell indexes, decals: Set of cell indexes } ---

  /** Everything touching the cells x0..x1, y0..y1 (a prop when any of its cells is inside). */
  selectArea(x0, y0, x1, y1) {
    const sel = emptySelection();
    for (let y = Math.max(0, y0); y <= Math.min(this.height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(this.width - 1, x1); x++) {
        const index = this.index(x, y);
        const prop = this.covers.get(index);
        if (prop) sel.props.add(prop);
        if (this.spawns.has(index)) sel.spawns.add(index);
        if (this.decals.has(index)) sel.decals.add(index);
      }
    }
    return sel;
  }

  selectAll() {
    return { props: new Set(this.props), spawns: new Set(this.spawns.keys()), decals: new Set(this.decals.keys()) };
  }

  /** Where the selection goes moved by (dx, dy) cells (see fits and apply). */
  planMove(sel, dx, dy) {
    const at = (index) => ({ x: (index % this.width) + dx, y: Math.floor(index / this.width) + dy });
    return {
      props: [...sel.props].map((p) => ({ code: p.code, variant: p.variant, x: p.x + dx, y: p.y + dy, turnedFrom: p.turnedFrom })),
      spawns: [...sel.spawns].map((index) => ({ team: this.spawns.get(index), ...at(index) })),
      decals: [...sel.decals].map((index) => ({ ...this.decals.get(index), ...at(index) })),
    };
  }

  /**
   * Where the selection goes turned a quarter turn clockwise about its middle:
   * the layout turns, and each piece becomes its turned version (rotation.js;
   * a piece without one keeps its shape, centred where it would be).
   */
  planTurn(sel) {
    let X0 = Infinity;
    let Y0 = Infinity;
    let X1 = -Infinity;
    let Y1 = -Infinity;
    const grow = (x, y, w, h) => {
      X0 = Math.min(X0, x);
      Y0 = Math.min(Y0, y);
      X1 = Math.max(X1, x + w);
      Y1 = Math.max(Y1, y + h);
    };
    for (const p of sel.props) grow(p.x, p.y, ...footprintOf(p.code, p.variant));
    for (const index of [...sel.spawns, ...sel.decals]) grow(index % this.width, Math.floor(index / this.width), 1, 1);
    // The turned box (h wide, w tall) keeps the same middle; trunc brings four turns back to the start.
    const w = X1 - X0;
    const h = Y1 - Y0;
    const bx = X0 + Math.trunc((w - h) / 2);
    const by = Y0 + Math.trunc((h - w) / 2);
    const turn = (index) => ({ x: bx + (Y1 - 1 - Math.floor(index / this.width)), y: by + ((index % this.width) - X0) });
    return {
      props: [...sel.props].map((p) => {
        const [pw, ph] = footprintOf(p.code, p.variant);
        const variant = turnProp(p.code, p.variant, p.turnedFrom);
        const [nw, nh] = footprintOf(p.code, variant);
        // Its cells turned: ph wide and pw tall, from here.
        const left = bx + (Y1 - (p.y + ph));
        const top = by + (p.x - X0);
        return { code: p.code, variant, x: left + Math.trunc((ph - nw) / 2), y: top + Math.trunc((pw - nh) / 2), turnedFrom: p.variant };
      }),
      spawns: [...sel.spawns].map((index) => ({ team: this.spawns.get(index), ...turn(index) })),
      decals: [...sel.decals].map((index) => {
        const d = this.decals.get(index);
        return { code: d.code, variant: turnDecal(d.code, d.variant), ...turn(index) };
      }),
    };
  }

  /** Whether a plan for the selection fits: inside the map, clear of everything not in the selection, and of itself. */
  fits(sel, plan) {
    const taken = new Set(); // cells the planned props cover
    for (const t of plan.props) {
      const [w, h] = footprintOf(t.code, t.variant);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          if (!this.inside(t.x + i, t.y + j)) return false;
          const index = this.index(t.x + i, t.y + j);
          const other = this.covers.get(index);
          if ((other && !sel.props.has(other)) || taken.has(index)) return false;
          if (this.spawns.has(index) && !sel.spawns.has(index)) return false;
          taken.add(index);
        }
      }
    }
    for (const s of plan.spawns) {
      if (!this.inside(s.x, s.y)) return false;
      const index = this.index(s.x, s.y);
      const other = this.covers.get(index);
      if (taken.has(index) || (other && !sel.props.has(other))) return false;
    }
    return plan.decals.every((d) => this.inside(d.x, d.y));
  }

  /** Lift the selection and put it down as planned (fits first): the new selection. Marks it lands on are replaced. */
  apply(sel, plan) {
    for (const p of sel.props) this.removeProp(p);
    for (const index of sel.spawns) this.spawns.delete(index);
    for (const index of sel.decals) this.decals.delete(index);
    const out = emptySelection();
    for (const t of plan.props) {
      const prop = this.place(t.code, t.variant, t.x, t.y);
      if (t.turnedFrom !== undefined) prop.turnedFrom = t.turnedFrom; // what it was before it was turned (rotation.js turnProp)
      out.props.add(prop);
    }
    for (const sp of plan.spawns) {
      this.setSpawn(sp.x, sp.y, sp.team);
      out.spawns.add(this.index(sp.x, sp.y));
    }
    for (const d of plan.decals) {
      this.setDecal(d.x, d.y, d.code, d.variant);
      out.decals.add(this.index(d.x, d.y));
    }
    return out;
  }

  /** Whether the selection fits moved by (dx, dy) cells. */
  canMove(sel, dx, dy) {
    return this.fits(sel, this.planMove(sel, dx, dy));
  }

  /** Move the selection by (dx, dy) cells when it fits: the moved selection, or null. */
  moveSelection(sel, dx, dy) {
    const plan = this.planMove(sel, dx, dy);
    return this.fits(sel, plan) ? this.apply(sel, plan) : null;
  }

  /** Turn the selection a quarter turn clockwise when it fits: the turned selection, or null. */
  rotateSelection(sel) {
    if (!selectionSize(sel)) return null;
    const plan = this.planTurn(sel);
    return this.fits(sel, plan) ? this.apply(sel, plan) : null;
  }

  removeSelection(sel) {
    let changed = false;
    for (const p of sel.props) changed = this.removeProp(p) || changed;
    for (const index of sel.spawns) changed = this.spawns.delete(index) || changed;
    for (const index of sel.decals) changed = this.decals.delete(index) || changed;
    return changed;
  }
}

export function emptySelection() {
  return { props: new Set(), spawns: new Set(), decals: new Set() };
}

export const selectionSize = (sel) => sel.props.size + sel.spawns.size + sel.decals.size;

function clampSize(n) {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.trunc(Number(n)) || MIN_SIZE));
}

/** "[skip]<letter><variant>" runs over the cells, in reading order. */
function encodeRuns(entries) {
  let out = '';
  let last = -1;
  for (const [index, letter, variant] of entries.sort((a, b) => a[0] - b[0])) {
    const skip = index - last - 1;
    out += (skip > 0 ? skip : '') + letter + (toAlphaNumericCharacter(variant) ?? '0');
    last = index;
  }
  return out;
}

/** The game's map string for a document. */
export function encodeMap(doc) {
  const obstacles = encodeRuns([
    ...doc.props.map((p) => [doc.index(p.x, p.y), p.code, p.variant]),
    ...[...doc.spawns].map(([index, team]) => [index, 's', team]),
  ]);
  // Terrain: colour, relief, then each texture letter followed by how many more of it come next.
  let terrain = doc.background.toString(16).padStart(6, '0').slice(-6) + toAlphaNumericCharacter(doc.relief + 1);
  const t = doc.textures;
  for (let i = 0; i < t.length; ) {
    let j = i;
    while (j + 1 < t.length && t[j + 1] === t[i]) j++;
    terrain += LETTERS[t[i]] + (j > i ? j - i : '');
    i = j + 1;
  }
  const decals = encodeRuns([...doc.decals].map(([index, d]) => [index, d.code, d.variant]));
  return `1${doc.width};${doc.height};${obstacles};${terrain};${decals};${doc.border}`;
}

/** Read "[skip]<letter><variant>" runs: calls each(index, letter, variantCharacter). */
function decodeRuns(text, each) {
  let index = 0;
  let digits = '';
  for (let i = 0; i < text.length; ) {
    const ch = text.charAt(i);
    if (ch >= '0' && ch <= '9') {
      digits += ch;
      i++;
      continue;
    }
    index += parseInt(digits, 10) || 0;
    digits = '';
    each(index, ch, text.charAt(i + 1));
    i += 2;
    index++;
  }
}

/** A document from a map string, read the way world.js parseMap reads it. */
export function decodeMap(mapString, name = 'My Map') {
  if (!mapString || mapString.charAt(0) !== '1') throw new Error('Not a map code (it should start with 1)');
  const parts = mapString.trim().substr(1).split(';');
  // The game swaps one broken Warehouse layout when it loads it (world.js repairWarehouse); so does the editor.
  if (parts[0] === '60' && parts[1] === '37' && parts[2] === WAREHOUSE_ORIGINAL) parts[2] = WAREHOUSE_FIXED;
  const width = parseInt(parts[0], 10);
  const height = parseInt(parts[1], 10);
  if (!(width >= 1 && height >= 1)) throw new Error('The map code has no size');
  if (width > MAX_SIZE || height > MAX_SIZE) throw new Error(`Maps can be at most ${MAX_SIZE} x ${MAX_SIZE}`);
  const doc = new MapDoc({ name, width: Math.max(width, MIN_SIZE), height: Math.max(height, MIN_SIZE) });
  doc.width = width;
  doc.height = height;
  doc.textures = new Uint8Array(width * height);
  const cell = (index) => [index % width, Math.floor(index / width)];
  decodeRuns(parts[2] || '', (index, letter, v) => {
    const [x, y] = cell(index);
    if (y >= height) return;
    if (letter === 's') doc.setSpawn(x, y, parseInt(v, 10) || 0, { lenient: true });
    else if (describeProp(letter, fromAlphaNumericCharacter(v) ?? 0)) doc.place(letter, fromAlphaNumericCharacter(v) ?? 0, x, y, { lenient: true });
  });
  const terrain = parts[3] || '';
  doc.background = parseInt(terrain.substr(0, 6), 16);
  if (!Number.isFinite(doc.background)) doc.background = DEFAULT_BACKGROUND;
  doc.relief = (fromAlphaNumericCharacter(terrain.charAt(6) || '1') ?? 1) - 1;
  if (doc.relief > 2) doc.relief = -1;
  let pos = 0;
  let digits = '';
  let texture = 0;
  const put = () => {
    if (pos < doc.textures.length) doc.textures[pos] = texture;
    pos++;
  };
  for (const ch of terrain.substr(7)) {
    if (ch >= '0' && ch <= '9') {
      digits += ch;
      continue;
    }
    for (let repeat = parseInt(digits, 10) || 0; repeat > 0; repeat--) put();
    digits = '';
    texture = fromAlphaCharacter(ch) ?? 0;
    put();
  }
  while (pos < doc.textures.length) put();
  decodeRuns(parts[4] || '', (index, letter, v) => {
    const [x, y] = cell(index);
    if (DECALS[letter] && y < height) doc.setDecal(x, y, letter, fromAlphaNumericCharacter(v) ?? 0);
  });
  doc.border = parts[5] ? parseInt(parts[5].charAt(0), 10) || 0 : 0;
  return doc;
}

export { DECAL_CODES };

/** A map code, a {name, data} file, or a maps.json list (its first map): a document. */
export function parseShared(text) {
  text = String(text || '').trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    let value = JSON.parse(text);
    if (Array.isArray(value)) value = value.find((m) => m && typeof m.data === 'string');
    if (!value || typeof value.data !== 'string') throw new Error('No map in this file');
    return decodeMap(value.data, value.name || 'My Map');
  }
  return decodeMap(text.replace(/\s+/g, ''), 'My Map');
}
