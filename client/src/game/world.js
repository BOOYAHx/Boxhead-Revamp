// The game world: map data, props, collision and bullet tracing.
// Ports of boxhead.world.{MapInfo, CellGrid, Map, Tracer} and the hit shapes.
// No rendering here, so the rules can be unit-tested under Node.

import { fromAlphaCharacter, fromAlphaNumericCharacter } from '../util/strings.js';
import { POSITION_RESOLUTION } from './constants.js';
import { WAREHOUSE_ORIGINAL, WAREHOUSE_FIXED } from './maps.js';

// --- hit shapes ----------------------------------------------------------------

export class HitCircle {
  constructor(pos, radius) {
    this.pos = pos; // shared reference to the owner's position
    this.radius = radius;
    this.next = null;
  }

  get x() {
    return this.pos.x;
  }

  get y() {
    return this.pos.y;
  }

  /** Vector pushing `circle` out of this shape, or null if they do not touch. */
  ejectCircle(circle) {
    const dx = circle.x - this.x;
    const dy = circle.y - this.y;
    const reach = circle.radius + this.radius;
    if (dx * dx + dy * dy > reach * reach) return null;
    const length = Math.hypot(dx, dy) || 1e-9;
    const push = reach - length;
    return { x: (dx / length) * push, y: (dy / length) * push };
  }

  /** Distance along a ray to this circle (TraceCollision), or null. */
  traceLine(start, angle) {
    const rx = this.x - start.x;
    const ry = this.y - start.y;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const along = rx * cos - ry * sin;
    const across = rx * sin + ry * cos;
    if (Math.abs(across) > this.radius) return null;
    const half = Math.sqrt(this.radius * this.radius - across * across);
    const far = along + half;
    if (far < 0) return null;
    const near = along - half;
    if (near <= 0 && far >= 0) return { x: start.x, y: start.y, distance: 0 };
    return { x: start.x + Math.cos(angle) * near, y: start.y + Math.sin(angle) * near, distance: near };
  }

  bounds() {
    return { left: this.x - this.radius, top: this.y - this.radius, right: this.x + this.radius, bottom: this.y + this.radius };
  }
}

export class HitRect {
  constructor(pos, xRad, yRad) {
    this.pos = pos;
    this.xRad = xRad;
    this.yRad = yRad;
    this.next = null;
  }

  get x() {
    return this.pos.x;
  }

  get y() {
    return this.pos.y;
  }

  // Faithful to HitRect.ejectCircle, including its comparison of y against 0
  // for circles whose centre is inside the rectangle, so walls push players
  // exactly as they do in the Flash client.
  ejectCircle(c) {
    const left = this.x - this.xRad;
    const toLeft = c.x + c.radius - left;
    if (toLeft <= 0) return null;
    const right = this.x + this.xRad;
    const toRight = right - (c.x - c.radius);
    if (toRight <= 0) return null;
    const top = this.y - this.yRad;
    const toTop = c.y + c.radius - top;
    if (toTop <= 0) return null;
    const bottom = this.y + this.yRad;
    const toBottom = bottom - (c.y - c.radius);
    if (toBottom <= 0) return null;
    const sx = c.x < left ? -1 : c.x > right ? 1 : 0;
    const sy = c.y < top ? -1 : c.y > bottom ? 1 : 0;
    if (sx === 0 && sy === 0) {
      if (c.x < this.x) {
        if (c.y < 0) return toLeft < toTop ? { x: -toLeft, y: 0 } : { x: 0, y: -toTop };
        return toLeft < toBottom ? { x: -toLeft, y: 0 } : { x: 0, y: toBottom };
      }
      if (c.y < 0) return toRight < toTop ? { x: toRight, y: 0 } : { x: 0, y: -toTop };
      return toRight < toBottom ? { x: toRight, y: 0 } : { x: 0, y: toBottom };
    }
    if (sx && sy) {
      const vx = c.x - this.x - this.xRad * sx;
      const vy = c.y - this.y - this.yRad * sy;
      const length = Math.hypot(vx, vy);
      const overlap = c.radius - length;
      if (overlap < 0) return null;
      return { x: (vx / (length || 1e-9)) * overlap, y: (vy / (length || 1e-9)) * overlap };
    }
    if (sx < 0) return { x: -toLeft, y: 0 };
    if (sx > 0) return { x: toRight, y: 0 };
    if (sy < 0) return { x: 0, y: -toTop };
    return { x: 0, y: toBottom };
  }

  traceLine(start, angle, dx, dy) {
    const left = this.x - this.xRad;
    const right = this.x + this.xRad;
    const top = this.y - this.yRad;
    const bottom = this.y + this.yRad;
    if (start.x >= left && start.x <= right && start.y >= top && start.y <= bottom) {
      return { x: start.x, y: start.y, distance: 0 };
    }
    const slope = dy / dx;
    const intercept = start.y - slope * start.x;
    const hit = (x, y) => ({ x, y, distance: Math.hypot(x - start.x, y - start.y) });
    if (dx > 0) {
      if (start.x > right) return null;
      if (start.x < left) {
        const y = slope * left + intercept;
        if (y <= bottom && y >= top) return hit(left, y);
      }
    } else if (dx < 0) {
      if (start.x < left) return null;
      if (start.x > right) {
        const y = slope * right + intercept;
        if (y <= bottom && y >= top) return hit(right, y);
      }
    }
    if (dy < 0) {
      if (start.y < top) return null;
      if (start.y > bottom) {
        const x = Number.isFinite(slope) ? (bottom - intercept) / slope : start.x;
        if (x <= right && x >= left) return hit(x, bottom);
      }
    }
    if (dy > 0) {
      if (start.y > bottom) return null;
      if (start.y < top) {
        const x = Number.isFinite(slope) ? (top - intercept) / slope : start.x;
        if (x <= right && x >= left) return hit(x, top);
      }
    }
    return null;
  }

  bounds() {
    return { left: this.x - this.xRad, top: this.y - this.yRad, right: this.x + this.xRad, bottom: this.y + this.yRad };
  }
}

// --- props -----------------------------------------------------------------------

// Obstacle heights (pixels above the ground) from boxhead.world.thing.obstacle.
const LOW_HEIGHT = 20;
const CRATE_HEIGHT = 27;

/**
 * Describe a prop placed by the map: footprint (cells), hit shapes relative to
 * the footprint centre, height, depth offset and the sprite names to draw.
 * Mirrors the constructors of each boxhead.world.thing.obstacle.prop class.
 */
export function describeProp(code, variant) {
  const rect = (xRad, yRad, ox = 0, oy = 0) => ({ type: 'rect', xRad, yRad, ox, oy });
  const circle = (radius) => ({ type: 'circle', radius, ox: 0, oy: 0 });
  const p = { kind: code, variant, footprint: [1, 1], hits: [], height: 0, depthOffset: 0, display: null, shadow: null };
  switch (code) {
    case 'w': {
      const v = variant || 1;
      if (v === 2) Object.assign(p, { hits: [rect(3, 0.75)], footprint: [6, 2], height: 48, depthOffset: 0.75, display: 'WallHorizontal', shadow: 'WallHorizontal_Shadow' });
      else if (v === 3) Object.assign(p, { hits: [rect(0.75, 3)], footprint: [2, 6], height: 48, depthOffset: 3, display: 'WallVertical', shadow: 'WallVertical_Shadow' });
      else Object.assign(p, { hits: [rect(1, 1)], footprint: [2, 2], height: 56, depthOffset: 1, display: 'WallPost', shadow: 'WallPost_Shadow' });
      p.variant = v;
      break;
    }
    case 't': {
      const v = variant || 1;
      const size = ((v - 1) % 2) + 1;
      Object.assign(p, {
        hits: [circle(v % 2 === 1 ? 0.5 : 1)],
        height: v % 2 === 1 ? 93 : 65,
        footprint: [size, size],
        depthOffset: 0.05,
        display: 'Tree' + size,
        shadow: 'Tree' + size + '_Shadow',
        tint: Math.trunc(v / 2) - 1, // colour variations (Assets.treeFilters)
      });
      break;
    }
    case 'r': {
      const v = variant || 1 + Math.floor(Math.random() * 2);
      Object.assign(p, { hits: [circle(0.5)], height: v === 2 ? LOW_HEIGHT : 47, display: 'Rock' + v, shadow: 'Rock' + v + '_Shadow' });
      break;
    }
    case 'c': {
      const v = variant || 1 + Math.floor(Math.random() * 2);
      Object.assign(p, { hits: [rect(0.5, 0.5)], height: CRATE_HEIGHT, display: 'Crate' + v, shadow: 'Crate_Shadow' });
      break;
    }
    case 'u':
      if (variant >= 20) {
        const v = variant - 20 || 1 + Math.floor(Math.random() * 4);
        const odd = v % 2 === 1;
        Object.assign(p, {
          kind: 'mailbox',
          hits: [odd ? rect(18 / 40, 8 / 28) : rect(16 / 40, 12 / 28)],
          depthOffset: odd ? 8 / 28 : 12 / 28,
          height: 35,
          display: 'Mailbox' + (v - 1),
          shadow: 'Mailbox_Shadow' + ((v + 1) % 2),
        });
      } else if (variant >= 10) {
        const v = variant - 10 || 1 + Math.floor(Math.random() * 2);
        Object.assign(p, { kind: 'hydrant', hits: [circle(0.3)], height: 30, display: 'FireHydrant' + (v - 1), shadow: 'FireHydrant_Shadow' });
      } else {
        const v = variant || 1 + Math.floor(Math.random() * 3);
        Object.assign(p, { kind: 'trashcan', hits: [circle(0.42)], height: 35, display: 'TrashCan' + (v - 1), shadow: 'TrashCan_Shadow' });
      }
      break;
    case 'f':
      if (variant >= 20) return castleWall(p, variant - 20 || 1);
      if (variant >= 10) return brickWall(p, variant - 10 || 1);
      return fence(p, variant || 1);
    case 'b':
      if (variant >= 20) return storeFrontLarge(p, variant - 20 || 1);
      if (variant >= 10) return storeFrontSmall(p, variant - 10 || 1);
      return factory(p, variant || 1);
    case 'a':
      return car(p, variant || 1);
    default:
      return null;
  }
  return p;

  function fence(q, v) {
    q.kind = 'fence';
    q.height = 53;
    q.depthOffset = 0.07;
    q.display = 'Fence' + v;
    q.shadow = 'Fence_Shadow' + v;
    if (v === 2 || v === 8) {
      q.hits = [rect(0.5, 0.07)];
      q.shadow = 'Fence_Shadow2';
    } else if (v === 4 || v === 6) {
      q.hits = [rect(0.07, 0.5)];
      q.depthOffset = 0.5;
      q.shadow = 'Fence_Shadow4';
    } else {
      const corner = { 1: [0.25, -0.25], 3: [-0.25, -0.25], 7: [0.25, 0.25], 9: [-0.25, 0.25] }[v] || [0, 0];
      q.hits = [rect(0.25, 0.07, corner[0], 0), rect(0.07, 0.25, 0, corner[1])];
    }
    return q;
  }

  function brickWall(q, v) {
    q.kind = 'brickwall';
    q.height = 69;
    q.display = 'BrickWall' + Math.min(3, v);
    q.shadow = 'BrickWall_Shadow' + Math.min(3, v);
    if (v === 1) Object.assign(q, { hits: [rect(1, 0.5)], depthOffset: 0.5, footprint: [2, 1] });
    else if (v === 2) Object.assign(q, { hits: [rect(0.5, 1)], depthOffset: 1, footprint: [1, 2] });
    else Object.assign(q, { hits: [rect(0.5, 0.5)], depthOffset: 0.5 });
    return q;
  }

  function castleWall(q, v) {
    q.kind = 'castlewall';
    q.height = 64;
    q.display = 'CastleWall' + v;
    if (v === 1) Object.assign(q, { hits: [rect(1, 1)], depthOffset: 1, footprint: [2, 2], shadow: 'CastleWall_Shadow1' });
    else if (v <= 3) Object.assign(q, { hits: [rect(0.5, 0.5)], depthOffset: 0.5, shadow: 'CastleWall_Shadow2' });
    else if (v <= 5) Object.assign(q, { hits: [rect(0.5, 0.5)], depthOffset: 0.5, shadow: 'CastleWall_Shadow4' });
    else if (v <= 7) Object.assign(q, { hits: [rect(0.5, 7 / 8)], depthOffset: 7 / 8, footprint: [1, 2], shadow: 'CastleWall_Shadow6' });
    else Object.assign(q, { hits: [rect(7 / 8, 0.5)], depthOffset: 0.5, footprint: [2, 1], shadow: 'CastleWall_Shadow' + v });
    return q;
  }

  function factory(q, v) {
    q.kind = 'factory';
    q.height = 126;
    q.depthOffset = 0.5;
    q.hits = [rect(0.5, 0.5)];
    q.display = 'Factory' + Math.min(6, v);
    q.shadow = v === 7 ? null : 'Factory_Shadow1';
    if (v === 4) Object.assign(q, { hits: [rect(1, 0.5)], footprint: [2, 1], shadow: 'Factory_Shadow2' });
    if (v === 5) Object.assign(q, { hits: [rect(1.5, 0.5)], footprint: [3, 1], shadow: 'Factory_Shadow3' });
    return q;
  }

  function storeFrontSmall(q, v) {
    Object.assign(q, { kind: 'storefront', height: 56, depthOffset: 0.5, hits: [rect(0.5, 0.5)] });
    if (v === 1) Object.assign(q, { hits: [rect(1, 0.5)], footprint: [2, 1], display: 'StoreFrontSmall1', shadow: 'StoreFrontSmall_Shadow1' });
    else if (v === 2) Object.assign(q, { display: 'StoreFrontSmall2', shadow: 'StoreFrontSmall_Shadow2' });
    else Object.assign(q, { display: 'StoreFrontSmallRoof', shadow: v === 3 ? 'StoreFrontSmall_Shadow2' : null });
    return q;
  }

  function storeFrontLarge(q, v) {
    Object.assign(q, { kind: 'storefront', height: 112, depthOffset: 0.5, hits: [rect(0.5, 0.5)] });
    q.display = v <= 4 ? 'StoreFrontLarge' + v : 'StoreFrontLargeRoof';
    q.shadow = v <= 5 ? 'StoreFrontLarge_Shadow' : null;
    return q;
  }

  function car(q, v) {
    q.kind = 'car';
    q.display = 'Car' + v;
    if (v <= 6) Object.assign(q, { hits: [rect(41 / 40, 18 / 28)], height: 24, footprint: [3, 2], shadow: 'Car_Shadow1' });
    else if (v <= 9) Object.assign(q, { hits: [rect(22 / 40, 30 / 28)], height: 24, footprint: [2, 3], shadow: 'Car_Shadow7' });
    else Object.assign(q, { hits: [rect(1, 0.5)], height: 66, footprint: [2, 1], shadow: v <= 12 ? 'Car_Shadow10' : 'Car_Shadow13' });
    q.depthOffset = q.hits[0].yRad;
    return q;
  }
}

export class Prop {
  constructor(desc, x, y) {
    Object.assign(this, desc);
    this.x = x;
    this.y = y;
    // Props are drawn and collide around the centre of their footprint.
    this.renderPos = { x: x + this.footprint[0] / 2, y: y + this.footprint[1] / 2 };
    this.depth = this.renderPos.y + this.depthOffset + (this.kind === 't' ? (x % (this.footprint[0] + 1)) * 0.02 : 0);
    let first = null;
    let last = null;
    for (const h of this.hits) {
      const pos = h.ox || h.oy ? { x: this.renderPos.x + h.ox, y: this.renderPos.y + h.oy } : this.renderPos;
      const shape = h.type === 'rect' ? new HitRect(pos, h.xRad, h.yRad) : new HitCircle(pos, h.radius);
      if (last) last.next = shape;
      else first = shape;
      last = shape;
    }
    this.hit = first;
  }
}

// --- map -------------------------------------------------------------------------

export const TEXTURES = [null, 'Grass1', 'Asphalt1', 'Asphalt2', 'Tiles', 'Wood', 'Pavement3', 'Pavement5', 'Pavers', 'Rocks', 'Road'];
export const RELIEFS = ['Relief1', 'Relief2', 'Relief3'];
export const DECALS = { a: 'Cracks', b: 'Curb', c: 'RoadLines', d: 'FloorDamage', e: 'GrassBits', f: 'GrassRockEdge', g: 'Sidewalk' };
export const DEFAULT_BG_COLOR = 0xebdcc7;

export class GameMap {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cells = new Array(width * height);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = { x: i % width, y: Math.floor(i / width), texture: 0, prop: null };
    this.props = [];
    this.spawns = [];
    this.decals = [];
    this.backgroundColor = DEFAULT_BG_COLOR;
    this.relief = RELIEFS[0];
    this.setBorder(0);
  }

  cellAt(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.cells[y * this.width + x];
  }

  setBorder(border) {
    this.border = Math.max(0, Math.min(9, border));
    const { width, height } = this;
    this.borderRect = { x: this.border, y: this.border, width: width - this.border * 2, height: height - this.border * 2 };
    // Invisible walls just outside the map (CellGrid.setBorder).
    this.borderHits = [
      new HitRect({ x: width / 2, y: -0.5 }, width / 2 + 1, 0.5),
      new HitRect({ x: -0.5, y: height / 2 }, 0.5, height / 2 + 1),
      new HitRect({ x: width / 2, y: height + 0.5 }, width / 2 + 1, 0.5),
      new HitRect({ x: width + 0.5, y: height / 2 }, 0.5, height / 2 + 1),
    ];
  }

  plantProp(prop) {
    const [fw, fh] = prop.footprint;
    for (let i = 0; i < fw; i++) for (let j = 0; j < fh; j++) if (this.cellAt(prop.x + i, prop.y + j)?.prop) return false;
    for (let i = 0; i < fw; i++) {
      for (let j = 0; j < fh; j++) {
        const cell = this.cellAt(prop.x + i, prop.y + j);
        if (cell) cell.prop = prop;
      }
    }
    this.props.push(prop);
    return true;
  }

  /** Solid hit shapes near a rectangle (in cells). */
  obstaclesNear(left, top, right, bottom) {
    const props = new Set();
    for (let y = Math.floor(top); y <= Math.floor(bottom); y++) {
      for (let x = Math.floor(left); x <= Math.floor(right); x++) {
        const prop = this.cellAt(x, y)?.prop;
        if (prop) props.add(prop);
      }
    }
    const shapes = [...this.borderHits];
    for (const prop of props) for (let h = prop.hit; h; h = h.next) shapes.push(h);
    return shapes;
  }
}

/**
 * Parse a map string as stored by xgen.stickarena.maps.get (MapInfo.load).
 * Format "1": width;height;obstacles;background+relief+textures;decals;border
 * Run lengths are written as decimal digits before a code.
 */
export function parseMap(mapString) {
  if (!mapString) throw new Error('Empty map');
  const format = mapString.charAt(0);
  if (format !== '1') throw new Error('Unsupported map format ' + format);
  const parts = repairWarehouse(mapString).substr(1).split(';');
  const width = parseInt(parts.shift(), 10);
  const height = parseInt(parts.shift(), 10);
  if (!width || !height) throw new Error('Invalid dimensions');
  const map = new GameMap(width, height);

  // Obstacles: [skip count] + type letter + alphanumeric variant.
  let text = parts.shift() || '';
  let x = 0;
  let y = 0;
  let digits = '';
  while (text.length > 0) {
    const ch = text.charAt(0);
    if (ch >= '0' && ch <= '9') {
      digits += ch;
      text = text.substr(1);
      continue;
    }
    const skip = parseInt(digits, 10);
    if (skip > 0) x += skip;
    digits = '';
    while (x >= width) {
      x -= width;
      y++;
    }
    const variant = fromAlphaNumericCharacter(text.charAt(1)) ?? 0;
    if (ch === 's') {
      map.spawns.push({ x: x + 0.5, y: y + 0.5, team: parseInt(text.charAt(1), 10) || 0 });
    } else {
      const desc = describeProp(ch, variant);
      if (desc) map.plantProp(new Prop(desc, x, y));
    }
    text = text.substr(2);
    x++;
  }

  // Terrain: RRGGBB, relief index, then textures; digits repeat the previous texture.
  text = parts.shift() || '';
  map.backgroundColor = parseInt(text.substr(0, 6), 16) || DEFAULT_BG_COLOR;
  const relief = (fromAlphaNumericCharacter(text.charAt(6) || '1') ?? 1) - 1;
  map.relief = RELIEFS[relief] ?? null;
  text = text.substr(7);
  x = 0;
  y = 0;
  digits = '';
  let texture = 0;
  const setTexture = () => {
    const cell = map.cellAt(x, y);
    if (cell) cell.texture = texture;
    x++;
    if (x >= width) {
      x -= width;
      y++;
    }
  };
  while (text.length > 0) {
    const ch = text.charAt(0);
    text = text.substr(1);
    if (ch >= '0' && ch <= '9') {
      digits += ch;
      continue;
    }
    for (let repeat = parseInt(digits, 10) || 0; repeat > 0; repeat--) setTexture();
    digits = '';
    texture = fromAlphaCharacter(ch) ?? 0;
    setTexture();
  }
  while (y < height) setTexture();

  // Decals: [skip] + type letter + variant.
  text = parts.shift() || '';
  x = 0;
  y = 0;
  digits = '';
  while (text.length > 0) {
    const ch = text.charAt(0);
    if (ch >= '0' && ch <= '9') {
      digits += ch;
      text = text.substr(1);
      continue;
    }
    const skip = parseInt(digits, 10);
    if (skip > 0) x += skip;
    digits = '';
    while (x >= width) {
      x -= width;
      y++;
    }
    if (DECALS[ch]) map.decals.push({ x, y, image: DECALS[ch], variant: fromAlphaNumericCharacter(text.charAt(1)) ?? 0 });
    text = text.substr(2);
    x++;
  }

  const border = parts.shift();
  map.setBorder(border ? parseInt(border.charAt(0), 10) || 0 : 0);
  return map;
}

// The patched client (WarehouseRepair) swaps one broken Warehouse obstacle layout.
function repairWarehouse(mapString) {
  if (!mapString.startsWith('160;37;')) return mapString;
  const parts = mapString.split(';');
  if (parts.length < 4 || parts[2] !== WAREHOUSE_ORIGINAL) return mapString;
  parts[2] = WAREHOUSE_FIXED;
  return parts.join(';');
}

// --- movement --------------------------------------------------------------------

const round = (v) => Math.trunc(v * POSITION_RESOLUTION) / POSITION_RESOLUTION;

/**
 * One tick of Character.move: step along moveDir, then resolve collisions
 * with props and the map border by ejection or sliding along one axis.
 * Mutates `ch.pos`; returns true when something was hit.
 */
export function moveCharacter(map, ch, speed) {
  const r = ch.moveHit.radius;
  const start = { x: ch.pos.x, y: ch.pos.y };
  const step = { x: ch.moveDir.dx, y: ch.moveDir.dy };
  const len = Math.hypot(step.x, step.y) || 1;
  step.x = round((step.x / len) * speed);
  step.y = round((step.y / len) * speed);
  ch.pos.x += step.x;
  ch.pos.y += step.y;

  const shapes = map.obstaclesNear(
    Math.min(start.x, ch.pos.x) - r - 1,
    Math.min(start.y, ch.pos.y) - r - 1,
    Math.max(start.x, ch.pos.x) + r + 1,
    Math.max(start.y, ch.pos.y) + r + 1,
  );
  const collisions = () => shapes.map((s) => s.ejectCircle(ch.moveHit)).filter(Boolean);

  let hits = collisions();
  const collided = hits.length > 0;
  let blocked = hits.length > 1;
  if (hits.length === 1) {
    const push = hits[0];
    const length = Math.hypot(push.x, push.y);
    const scale = length ? (length + 1e-9) / length : 1;
    const px = push.x * scale;
    const py = push.y * scale;
    ch.pos.x += px < 0 ? Math.ceil(px * POSITION_RESOLUTION) / POSITION_RESOLUTION : Math.floor(px * POSITION_RESOLUTION) / POSITION_RESOLUTION;
    ch.pos.y += py < 0 ? Math.ceil(py * POSITION_RESOLUTION) / POSITION_RESOLUTION : Math.floor(py * POSITION_RESOLUTION) / POSITION_RESOLUTION;
    hits = collisions();
    if (hits.length > 0) blocked = true;
  }
  if (blocked) {
    // Try each axis on its own and keep whichever is free.
    ch.pos.x = start.x + step.x;
    ch.pos.y = start.y;
    const xFree = collisions().length === 0;
    ch.pos.x = start.x;
    ch.pos.y = start.y + step.y;
    const yFree = collisions().length === 0;
    ch.pos.x = start.x;
    ch.pos.y = start.y;
    if (xFree && yFree) {
      if (Math.abs(step.x) > Math.abs(step.y)) ch.pos.x += step.x;
      else ch.pos.y += step.y;
    } else if (xFree) ch.pos.x += step.x;
    else if (yFree) ch.pos.y += step.y;
  }
  ch.pos.x = Math.round(ch.pos.x * POSITION_RESOLUTION) / POSITION_RESOLUTION;
  ch.pos.y = Math.round(ch.pos.y * POSITION_RESOLUTION) / POSITION_RESOLUTION;
  return collided;
}

// --- bullets ---------------------------------------------------------------------

/**
 * Tracer.checkCollisions: walk the cells along the ray until a prop at least
 * as tall as the bullet blocks it, then collect characters closer than that.
 * Returns { distance, characters: [{ target, distance }] }.
 */
export function traceShot(map, start, angle, altitude, maxRange, characters, shooter) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let distance = maxRange;
  let blocked = false;
  const seen = new Set();
  // Sample the ray finely enough to visit every cell it crosses.
  const stepLength = 0.25;
  for (let t = 0; t <= maxRange + 1 && !blocked; t += stepLength) {
    const cell = map.cellAt(start.x + dx * t, start.y + dy * t);
    if (!cell) {
      if (t > 0) break;
      continue;
    }
    const prop = cell.prop;
    if (!prop || seen.has(prop)) continue;
    seen.add(prop);
    if (altitude > prop.height) continue;
    for (let h = prop.hit; h; h = h.next) {
      const hit = h.traceLine(start, angle, dx, dy);
      if (hit && hit.distance < distance) {
        distance = hit.distance;
        blocked = true;
      }
    }
  }
  const hits = [];
  for (const target of characters) {
    if (target === shooter || altitude > target.height) continue;
    const hit = target.fireHit.traceLine(start, angle, dx, dy);
    if (hit && hit.distance < distance) hits.push({ target, distance: hit.distance });
  }
  hits.sort((a, b) => a.distance - b.distance);
  return { distance, characters: hits };
}

/**
 * Map.spawnCharacter / evaluateSpawnPoint: score each spawn point by how
 * close the enemies are (sum of 1 / distance) and pick randomly among the
 * best ones (up to three within a factor of two of the best score).
 */
export function chooseSpawn(spawns, enemies, random = Math.random) {
  let best = Infinity;
  let candidates = [];
  for (const spawn of spawns) {
    let score = 0;
    for (const enemy of enemies) score += 1 / Math.min(999, Math.max(1, Math.hypot(enemy.pos.x - spawn.x, enemy.pos.y - spawn.y)));
    if (score < best) {
      if (score * 2 < best) candidates = [spawn];
      else {
        candidates.push(spawn);
        if (candidates.length > 3) candidates.shift();
      }
      best = score;
    } else if (score === best) {
      candidates.push(spawn);
    }
  }
  return candidates.length ? candidates[Math.floor(random() * candidates.length)] : null;
}
