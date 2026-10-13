// The map editor's document: a map as the editor keeps it (prop codes, not
// game objects) and its conversion to and from the game's map strings
// (MapInfo format "1", read by game/world.js parseMap). No drawing here, so it
// can be tested under Node.

import { DECALS, describeProp } from '../game/world.js';
import { WAREHOUSE_FIXED, WAREHOUSE_ORIGINAL } from '../game/maps.js';
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
}

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
