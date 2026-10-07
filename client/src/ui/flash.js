// A small Flash display list drawn with SVG, used to rebuild the original
// menus from the art the asset build exported (tools/swf_vector.py):
// library.svg holds every shape and static text, library.json the sprites,
// buttons and text fields. Instances keep their Flash instance names, so the
// menu code can find "loginButton" or "_nameField" like the ActionScript did.

const SVGNS = 'http://www.w3.org/2000/svg';
const XHTMLNS = 'http://www.w3.org/1999/xhtml';
const BLEND = { 3: 'multiply', 4: 'screen', 5: 'lighten', 6: 'darken', 7: 'difference', 8: 'plus-lighter', 9: 'difference', 13: 'overlay', 14: 'hard-light' };
const ALIGN = ['left', 'right', 'center', 'justify'];

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const n = (v) => +v.toFixed(4);
const matrixString = (m) => `matrix(${n(m[0])} ${n(m[1])} ${n(m[2])} ${n(m[3])} ${n(m[4])} ${n(m[5])})`;

/** "matrix(a b c d e f)" or "translate(x y)" as [a, b, c, d, e, f]. */
function parseTransform(text) {
  const numbers = (text || '').match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number) || [];
  if (/^\s*translate/.test(text || '')) return [1, 0, 0, 1, numbers[0] || 0, numbers[1] || 0];
  return numbers.length === 6 ? numbers : [1, 0, 0, 1, 0, 0];
}

/** Axis-aligned bounds [x0, y0, x1, y1] of `b` drawn through matrix `m`. */
export function transformBounds(b, m) {
  if (!b) return null;
  const xs = [b[0] * m[0] + b[1] * m[2], b[2] * m[0] + b[1] * m[2], b[0] * m[0] + b[3] * m[2], b[2] * m[0] + b[3] * m[2]];
  const ys = [b[0] * m[1] + b[1] * m[3], b[2] * m[1] + b[1] * m[3], b[0] * m[1] + b[3] * m[3], b[2] * m[1] + b[3] * m[3]];
  return [Math.min(...xs) + m[4], Math.min(...ys) + m[5], Math.max(...xs) + m[4], Math.max(...ys) + m[5]];
}

function union(list) {
  const valid = list.filter(Boolean);
  if (!valid.length) return null;
  return [Math.min(...valid.map((b) => b[0])), Math.min(...valid.map((b) => b[1])), Math.max(...valid.map((b) => b[2])), Math.max(...valid.map((b) => b[3]))];
}

export class FlashLibrary {
  constructor(data, defs) {
    this.chars = data.characters;
    this.classes = data.classes;
    this.classNames = Object.fromEntries(Object.entries(data.classes).map(([name, id]) => [id, name]));
    this.behaviors = {}; // symbol class name -> function(instance), like the ActionScript classes
    this.fonts = data.fonts || [];
    this.defs = defs; // <defs> of the hidden library <svg>
    this.filters = new Map();
    this.counter = 0;
  }

  /** Fetch the exported art, put its <defs> in the page and load the fonts. */
  static async load(base = 'assets/game/ui/') {
    const [data, text] = await Promise.all([
      fetch(base + 'library.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('library.json ' + r.status)))),
      fetch(base + 'library.svg', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error('library.svg ' + r.status)))),
    ]);
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    holder.innerHTML = text;
    document.body.appendChild(holder);
    const library = new FlashLibrary(data, holder.querySelector('defs'));
    await library.loadFonts();
    return library;
  }

  async loadFonts() {
    const loads = this.fonts.map((f) => {
      const face = new FontFace(f.family, `url(${f.url})`, { weight: f.bold ? '700' : '400', style: f.italic ? 'italic' : 'normal' });
      document.fonts.add(face);
      return face.load().catch(() => null);
    });
    await Promise.all(loads);
  }

  /** A new instance of a symbol class ("MMOcha.lobby.MMOchaLogin") or character id. */
  create(symbol) {
    const id = typeof symbol === 'number' ? symbol : this.classes[symbol];
    if (id === undefined) throw new Error('Unknown symbol ' + symbol);
    return this.instantiate(id, {});
  }

  instantiate(id, place) {
    let obj;
    switch (this.chars[id]?.type) {
      case 'shape':
      case 'text':
        obj = new Shape(this, id, place);
        break;
      case 'sprite':
        obj = new MovieClip(this, id, place);
        break;
      case 'button':
        obj = new SimpleButton(this, id, place);
        break;
      case 'edittext':
        obj = new TextField(this, id, place);
        break;
      default:
        obj = new DisplayObject(this, id, place);
    }
    obj.className = this.classNames[id] || '';
    const behavior = this.behaviors[obj.className];
    if (behavior) behavior(obj);
    return obj;
  }

  newID(prefix) {
    this.counter += 1;
    return prefix + this.counter;
  }

  /**
   * A copy of pattern/gradient `id` drawn through the extra matrix `m`
   * (for 9-slice scaling). Shapes reference paints in shape coordinates.
   */
  transformedPaint(id, m) {
    const source = this.defs.querySelector(`#${CSS.escape(id)}`);
    if (!source) return null;
    const attr = source.tagName === 'pattern' ? 'patternTransform' : 'gradientTransform';
    const old = parseTransform(source.getAttribute(attr));
    const combined = [
      m[0] * old[0] + m[2] * old[1],
      m[1] * old[0] + m[3] * old[1],
      m[0] * old[2] + m[2] * old[3],
      m[1] * old[2] + m[3] * old[3],
      m[0] * old[4] + m[2] * old[5] + m[4],
      m[1] * old[4] + m[3] * old[5] + m[5],
    ];
    const copy = source.cloneNode(true);
    const newID = this.newID('pt');
    copy.setAttribute('id', newID);
    copy.setAttribute(attr, matrixString(combined));
    this.defs.appendChild(copy);
    return newID;
  }

  /** A shared SVG filter for a colour transform and/or Flash filters. */
  filter(cxform, filters) {
    const key = JSON.stringify([cxform, filters]);
    let id = this.filters.get(key);
    if (id) return id;
    id = this.newID('flt');
    const f = svg('filter', { id, x: '-50%', y: '-50%', width: '200%', height: '200%', 'color-interpolation-filters': 'sRGB' });
    let source = 'SourceGraphic';
    if (cxform) {
      const [m, a] = cxform;
      const values = [m[0], 0, 0, 0, a[0] / 255, 0, m[1], 0, 0, a[1] / 255, 0, 0, m[2], 0, a[2] / 255, 0, 0, 0, m[3], a[3] / 255];
      f.appendChild(svg('feColorMatrix', { type: 'matrix', values: values.map(n).join(' '), in: source, result: 'cx' }));
      source = 'cx';
    }
    for (const filter of filters || []) source = appendFilter(f, filter, source, this.newID('r'));
    this.defs.appendChild(f);
    this.filters.set(key, id);
    return id;
  }
}

/** Flash blur sizes are box widths over a number of passes; this is the matching Gaussian. */
function deviation(size, passes) {
  return Math.sqrt(Math.max(0, (Math.max(1, passes || 1) * (size * size - 1)) / 12));
}

function appendFilter(f, filter, source, id) {
  const add = (tag, attrs) => f.appendChild(svg(tag, attrs));
  const std = `${n(deviation(filter.blurX || 0, filter.passes))} ${n(deviation(filter.blurY || 0, filter.passes))}`;
  const flood = (c, strength = 1) => ({ 'flood-color': `rgb(${c[0]},${c[1]},${c[2]})`, 'flood-opacity': n(Math.min(1, (c[3] / 255) * 1)) });
  const out = id + 'o';
  switch (filter.type) {
    case 'blur':
      add('feGaussianBlur', { in: source, stdDeviation: std, result: out });
      return out;
    case 'colormatrix': {
      const v = filter.matrix.map((x, i) => (i % 5 === 4 ? x / 255 : x));
      add('feColorMatrix', { in: source, type: 'matrix', values: v.map(n).join(' '), result: out });
      return out;
    }
    case 'glow':
    case 'shadow': {
      const dx = filter.type === 'shadow' ? Math.cos(filter.angle) * filter.distance : 0;
      const dy = filter.type === 'shadow' ? Math.sin(filter.angle) * filter.distance : 0;
      const strength = n(filter.strength || 1);
      if (filter.inner) {
        // Shadow of the outside, kept inside the shape.
        add('feComponentTransfer', { in: source, result: id + 'inv' }).appendChild(svg('feFuncA', { type: 'table', tableValues: '1 0' }));
        add('feGaussianBlur', { in: id + 'inv', stdDeviation: std, result: id + 'b' });
        add('feOffset', { in: id + 'b', dx: n(dx), dy: n(dy), result: id + 'off' });
        add('feComponentTransfer', { in: id + 'off', result: id + 's' }).appendChild(svg('feFuncA', { type: 'linear', slope: strength }));
        add('feFlood', { ...flood(filter.color), result: id + 'c' });
        add('feComposite', { in: id + 'c', in2: id + 's', operator: 'in', result: id + 'g' });
        add('feComposite', { in: id + 'g', in2: source, operator: 'in', result: id + 'gi' });
        if (filter.knockout) {
          add('feComposite', { in: id + 'gi', in2: id + 'gi', operator: 'over', result: out });
          return out;
        }
        add('feComposite', { in: id + 'gi', in2: source, operator: 'over', result: out });
        return out;
      }
      add('feGaussianBlur', { in: source, stdDeviation: std, result: id + 'b' });
      add('feOffset', { in: id + 'b', dx: n(dx), dy: n(dy), result: id + 'off' });
      add('feComponentTransfer', { in: id + 'off', result: id + 's' }).appendChild(svg('feFuncA', { type: 'linear', slope: strength }));
      add('feFlood', { ...flood(filter.color), result: id + 'c' });
      add('feComposite', { in: id + 'c', in2: id + 's', operator: 'in', result: id + 'g' });
      if (filter.knockout) {
        add('feComposite', { in: id + 'g', in2: source, operator: 'out', result: out });
        return out;
      }
      const merge = add('feMerge', { result: out });
      merge.appendChild(svg('feMergeNode', { in: id + 'g' }));
      merge.appendChild(svg('feMergeNode', { in: source }));
      return out;
    }
    case 'bevel': {
      // Highlight on the light side and shadow on the far side, inside the shape.
      const dx = Math.cos(filter.angle) * filter.distance;
      const dy = Math.sin(filter.angle) * filter.distance;
      add('feGaussianBlur', { in: source, stdDeviation: std, result: id + 'b' });
      add('feOffset', { in: id + 'b', dx: n(-dx), dy: n(-dy), result: id + 'h1' });
      add('feOffset', { in: id + 'b', dx: n(dx), dy: n(dy), result: id + 's1' });
      add('feComposite', { in: id + 'h1', in2: id + 's1', operator: 'out', result: id + 'h2' });
      add('feComposite', { in: id + 's1', in2: id + 'h1', operator: 'out', result: id + 's2' });
      add('feFlood', { ...flood(filter.highlight), result: id + 'hc' });
      add('feComposite', { in: id + 'hc', in2: id + 'h2', operator: 'in', result: id + 'h3' });
      add('feFlood', { ...flood(filter.shadow), result: id + 'sc' });
      add('feComposite', { in: id + 'sc', in2: id + 's2', operator: 'in', result: id + 's3' });
      const merge = add('feMerge', { result: id + 'm' });
      merge.appendChild(svg('feMergeNode', { in: id + 'h3' }));
      merge.appendChild(svg('feMergeNode', { in: id + 's3' }));
      add('feComposite', { in: id + 'm', in2: source, operator: 'in', result: id + 'mi' });
      add('feComposite', { in: id + 'mi', in2: source, operator: 'over', result: out });
      return out;
    }
    default:
      return source; // gradient glow/bevel and convolution are not drawn
  }
}

export class DisplayObject {
  constructor(lib, id, place = {}) {
    this.lib = lib;
    this.id = id;
    this.name = place.name || '';
    this.depth = place.depth || 0;
    this.clipDepth = place.clipDepth || 0;
    this.parent = null;
    this.el = svg('g');
    this.matrix = [1, 0, 0, 1, 0, 0];
    this._visible = true;
    this._alpha = 1;
    this.listeners = [];
    this.applyPlacement(place);
  }

  /** PlaceObject properties: matrix, colour transform, filters, blend mode, name. */
  applyPlacement(place) {
    if (place.matrix) this.matrix = [...place.matrix];
    if (place.name) {
      this.name = place.name;
      this.el.dataset.name = place.name;
    }
    this.updateTransform();
    const cx = place.cxform;
    const alphaOnly = cx && cx[0][0] === 1 && cx[0][1] === 1 && cx[0][2] === 1 && !cx[1].some((v) => v);
    this.cxAlpha = alphaOnly ? cx[0][3] : 1;
    const needsFilter = (cx && !alphaOnly) || (place.filters && place.filters.length);
    if (needsFilter) this.el.setAttribute('filter', `url(#${this.lib.filter(alphaOnly ? null : cx, place.filters)})`);
    else this.el.removeAttribute('filter');
    if (place.blend && BLEND[place.blend]) this.el.style.mixBlendMode = BLEND[place.blend];
    if (place.visible === false) this._visible = false;
    this.updateStyle();
  }

  updateTransform() {
    const m = this.matrix;
    if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1) {
      if (m[4] || m[5]) this.el.setAttribute('transform', `translate(${n(m[4])} ${n(m[5])})`);
      else this.el.removeAttribute('transform');
    } else this.el.setAttribute('transform', matrixString(m));
  }

  updateStyle() {
    this.el.style.display = this._visible ? '' : 'none';
    const alpha = this._alpha * (this.cxAlpha ?? 1);
    if (alpha < 1) this.el.setAttribute('opacity', n(Math.max(0, alpha)));
    else this.el.removeAttribute('opacity');
  }

  get x() {
    return this.matrix[4];
  }

  set x(v) {
    this.matrix[4] = v;
    this.updateTransform();
  }

  get y() {
    return this.matrix[5];
  }

  set y(v) {
    this.matrix[5] = v;
    this.updateTransform();
  }

  get scaleX() {
    return this.matrix[0];
  }

  set scaleX(v) {
    this.matrix[0] = v;
    this.updateTransform();
  }

  get scaleY() {
    return this.matrix[3];
  }

  set scaleY(v) {
    this.matrix[3] = v;
    this.updateTransform();
  }

  /** Bounds in the object's own coordinates. */
  localBounds() {
    return null;
  }

  /** Bounds in the parent's coordinates (what ActionScript's width/height measure). */
  get bounds() {
    return transformBounds(this.localBounds(), this.matrix);
  }

  get width() {
    const b = this.bounds;
    return b ? b[2] - b[0] : 0;
  }

  get height() {
    const b = this.bounds;
    return b ? b[3] - b[1] : 0;
  }

  /** The pointer position of a DOM event in this object's coordinates. */
  localPoint(event) {
    const ctm = this.el.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  get visible() {
    return this._visible;
  }

  set visible(v) {
    this._visible = !!v;
    this.updateStyle();
  }

  get alpha() {
    return this._alpha;
  }

  set alpha(v) {
    this._alpha = v;
    this.updateStyle();
  }

  /** DOM events on the drawn element ("click", "pointerdown", ...). Returns an unsubscribe function. */
  on(type, fn) {
    this.el.addEventListener(type, fn);
    const off = () => this.el.removeEventListener(type, fn);
    this.listeners.push(off);
    return off;
  }

  /** A descendant by instance-name path: clip.child('windows._userListWindow'). */
  child(path) {
    let node = this;
    for (const part of path.split('.')) {
      node = node?.getChildByName?.(part) || null;
      if (!node) return null;
    }
    return node;
  }

  getChildByName() {
    return null;
  }

  remove() {
    this.el.remove();
    if (this.parent) this.parent.detach(this);
  }

  destroy() {
    for (const off of this.listeners) off();
    this.listeners = [];
    this.el.remove();
  }
}

export class Shape extends DisplayObject {
  constructor(lib, id, place) {
    super(lib, id, place);
    const use = svg('use');
    use.setAttribute('href', `#c${id}`);
    this.el.appendChild(use);
  }

  localBounds() {
    return this.lib.chars[this.id].bounds;
  }
}

/** Builds the children for one display list (sprite frame or button state), with masks. */
function buildList(container, lib, list, reuse) {
  const children = [];
  for (const place of list) {
    let child = reuse?.get(place.depth);
    if (child && child.id === place.id) {
      reuse.delete(place.depth);
      child.applyPlacement(place);
    } else {
      child = lib.instantiate(place.id, place);
    }
    child.depth = place.depth;
    child.clipDepth = place.clipDepth || 0;
    children.push(child);
  }
  // Masks: a placed object with a clip depth masks the depths above it up to that depth.
  container.replaceChildren();
  let target = container;
  let maskEnd = 0;
  for (const child of children) {
    if (maskEnd && child.depth > maskEnd) {
      target = container;
      maskEnd = 0;
    }
    if (child.clipDepth) {
      const id = lib.newID('mask');
      const mask = svg('mask', { id, maskUnits: 'userSpaceOnUse', x: -4000, y: -4000, width: 8000, height: 8000, style: 'mask-type:alpha' });
      mask.appendChild(child.el);
      const group = svg('g', { mask: `url(#${id})` });
      container.appendChild(mask);
      container.appendChild(group);
      target = group;
      maskEnd = child.clipDepth;
      continue;
    }
    target.appendChild(child.el);
  }
  return children;
}

export class MovieClip extends DisplayObject {
  constructor(lib, id, place) {
    super(lib, id, place);
    this.def = lib.chars[id];
    this.children = [];
    this.currentFrame = 0;
    this.content = svg('g');
    this.el.appendChild(this.content);
    this.goto(0);
    if (this.def.scale9) this.updateTransform();
  }

  get totalFrames() {
    return Math.max(1, this.def.frames.length);
  }

  /** 1-based frame number or frame label, like MovieClip.gotoAndStop. */
  gotoAndStop(frame) {
    const index = typeof frame === 'string' ? this.def.labels[frame] : frame - 1;
    if (index !== undefined && index >= 0) this.goto(Math.min(index, this.totalFrames - 1));
  }

  goto(index) {
    this.currentFrame = index;
    const reuse = new Map(this.children.map((c) => [c.depth, c]));
    this.children = buildList(this.content, this.lib, this.def.frames[index] || [], reuse);
    for (const c of this.children) c.parent = this;
    for (const old of reuse.values()) old.destroy();
    if (this.def.scale9) this.applyScale9();
  }

  getChildByName(name) {
    return this.children.find((c) => c.name === name) || null;
  }

  localBounds() {
    return union(this.children.map((c) => c.bounds));
  }

  detach(child) {
    this.children = this.children.filter((c) => c !== child);
  }

  /** Add an instance created by code (addChild). */
  addChild(child) {
    child.parent = this;
    this.children.push(child);
    this.content.appendChild(child.el);
    return child;
  }

  updateTransform() {
    if (!this.def?.scale9) return super.updateTransform();
    // 9-slice: the clip itself is only moved; its shapes are redrawn stretched
    // with the corners kept at their original size.
    const m = this.matrix;
    this.el.setAttribute('transform', `translate(${n(m[4])} ${n(m[5])})`);
    if (this.children) this.applyScale9();
  }

  applyScale9() {
    const [l, t, r, b] = this.def.scale9;
    const sx = this.matrix[0];
    const sy = this.matrix[3];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of this.children) {
      const bounds = c.bounds;
      if (!bounds) continue;
      x0 = Math.min(x0, bounds[0]);
      y0 = Math.min(y0, bounds[1]);
      x1 = Math.max(x1, bounds[2]);
      y1 = Math.max(y1, bounds[3]);
    }
    if (!Number.isFinite(x0)) return;
    const axis = (lo, hi, g0, g1, s) => {
      const left = g0 - lo;
      const right = hi - g1;
      const outer = lo * s;
      const end = hi * s;
      const k = Math.min(1, (end - outer) / Math.max(1e-6, left + right));
      return (v) => {
        if (v <= g0) return outer + (v - lo) * k;
        if (v >= g1) return end - (hi - v) * k;
        const from = outer + left * k;
        const to = end - right * k;
        return from + ((v - g0) / Math.max(1e-6, g1 - g0)) * (to - from);
      };
    };
    const fx = axis(x0, x1, l, r, sx);
    const fy = axis(y0, y1, t, b, sy);
    for (const c of this.children) {
      if (!(c instanceof Shape)) {
        c.el.setAttribute('transform', `translate(${n(fx(c.x))} ${n(fy(c.y))})`);
        continue;
      }
      const source = this.lib.defs.querySelector(`#c${c.id}`);
      if (!source) continue;
      const copy = source.cloneNode(true);
      copy.removeAttribute('id');
      const [a, , , d, tx, ty] = c.matrix;
      for (const path of copy.querySelectorAll('path')) {
        const parts = path.getAttribute('d').match(/[MLQZ]|-?[\d.]+(?:e-?\d+)?/g) || [];
        let out = '';
        let isX = true;
        let bx0 = Infinity;
        let by0 = Infinity;
        let bx1 = -Infinity;
        let by1 = -Infinity;
        for (const p of parts) {
          if (/[MLQZ]/.test(p)) {
            out += p;
            isX = true;
            continue;
          }
          const v = parseFloat(p);
          if (isX) {
            const x = v * a + tx;
            bx0 = Math.min(bx0, x);
            bx1 = Math.max(bx1, x);
            out += n(fx(x)) + ' ';
          } else {
            const y = v * d + ty;
            by0 = Math.min(by0, y);
            by1 = Math.max(by1, y);
            out += n(fy(y)) + ' ';
          }
          isX = !isX;
        }
        path.setAttribute('d', out);
        if (path.getAttribute('vector-effect') !== 'non-scaling-stroke' && path.getAttribute('stroke-width')) {
          path.setAttribute('vector-effect', 'non-scaling-stroke');
        }
        // A slice's bitmap or gradient fill stretches with the slice.
        const fill = /^url\(#(.+)\)$/.exec(path.getAttribute('fill') || '');
        if (fill && Number.isFinite(bx0)) {
          const ax = bx1 > bx0 ? (fx(bx1) - fx(bx0)) / (bx1 - bx0) : 1;
          const ay = by1 > by0 ? (fy(by1) - fy(by0)) / (by1 - by0) : 1;
          const slice = [ax * a, 0, 0, ay * d, fx(bx0) - ax * bx0 + ax * tx, fy(by0) - ay * by0 + ay * ty];
          const paint = this.lib.transformedPaint(fill[1], slice);
          if (paint) path.setAttribute('fill', `url(#${paint})`);
        }
      }
      c.el.replaceChildren(copy);
      c.el.removeAttribute('transform');
    }
  }

  destroy() {
    for (const c of this.children) c.destroy();
    super.destroy();
  }
}

export class SimpleButton extends DisplayObject {
  constructor(lib, id, place) {
    super(lib, id, place);
    const def = lib.chars[id];
    this.groups = {};
    this.stateChildren = {};
    for (const state of ['up', 'over', 'down', 'hit']) {
      const g = svg('g', { class: 'state-' + state });
      this.stateChildren[state] = buildList(g, lib, def.states[state] || [], null);
      this.groups[state] = g;
    }
    const hit = this.groups.hit;
    hit.setAttribute('opacity', '0');
    hit.style.cursor = 'pointer';
    for (const state of ['up', 'over', 'down']) {
      this.groups[state].style.pointerEvents = 'none';
      this.el.appendChild(this.groups[state]);
    }
    this.el.appendChild(hit);
    this._enabled = true;
    this.pressed = false;
    this.hover = false;
    hit.addEventListener('pointerenter', () => ((this.hover = true), this.refresh()));
    hit.addEventListener('pointerleave', () => ((this.hover = false), (this.pressed = false), this.refresh()));
    hit.addEventListener('pointerdown', () => ((this.pressed = true), this.refresh()));
    hit.addEventListener('pointerup', () => ((this.pressed = false), this.refresh()));
    this.refresh();
  }

  refresh() {
    const state = !this._enabled ? 'up' : this.pressed ? 'down' : this.hover ? 'over' : 'up';
    for (const s of ['up', 'over', 'down']) this.groups[s].style.display = s === state ? '' : 'none';
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(v) {
    this._enabled = !!v;
    this.groups.hit.style.pointerEvents = v ? '' : 'none';
    this.groups.hit.style.cursor = v ? 'pointer' : '';
    this.refresh();
  }

  /** Text fields inside the button's states, e.g. a TextButton's label. */
  getChildByName(name) {
    for (const state of ['up', 'over', 'down']) {
      const found = this.stateChildren[state].find((c) => c.name === name);
      if (found) return found;
    }
    return null;
  }

  /** Every child of every state (labels are often repeated in each state). */
  allChildren() {
    return ['up', 'over', 'down'].flatMap((s) => this.stateChildren[s]);
  }

  localBounds() {
    const list = this.stateChildren.up.length ? this.stateChildren.up : this.stateChildren.hit;
    return union(list.map((c) => c.bounds));
  }

  destroy() {
    for (const s of Object.values(this.stateChildren)) for (const c of s) c.destroy();
    super.destroy();
  }
}

export class TextField extends DisplayObject {
  constructor(lib, id, place) {
    super(lib, id, place);
    const def = (this.def = lib.chars[id]);
    const [x0, y0, x1, y1] = def.bounds;
    this.object = svg('foreignObject', { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) });
    this.input = !def.readOnly;
    const tag = this.input ? (def.multiline ? 'textarea' : 'input') : 'div';
    const box = (this.box = document.createElementNS(XHTMLNS, tag));
    if (this.input && !def.multiline) box.type = def.password ? 'password' : 'text';
    if (def.maxLength && this.input) box.maxLength = def.maxLength;
    const size = def.size || 12;
    const lineHeight = def.ascent ? (def.ascent + def.descent) * size : size * 1.15;
    this.lineHeight = lineHeight + (def.multiline ? def.leading || 0 : 0);
    const family = def.fontFamily ? `"${def.fontFamily}", ` : '';
    Object.assign(box.style, {
      boxSizing: 'border-box',
      display: 'block', // an inline input would sit on an invisible text baseline, a few pixels low
      width: '100%',
      // A one-line input is one line tall plus Flash's 2px gutter, so the text sits 2px from
      // the top like Flash's, instead of being centred in the whole box by the browser.
      height: this.input && !def.multiline ? `${2 + lineHeight}px` : '100%',
      margin: '0',
      padding: `2px ${2 + (def.rightMargin || 0)}px 0 ${2 + (def.leftMargin || 0) + (def.indent || 0)}px`,
      font: `${def.italic ? 'italic ' : ''}${def.bold ? 'bold ' : ''}${size}px ${family}Arial, sans-serif`,
      lineHeight: `${this.lineHeight}px`,
      color: `rgba(${def.color[0]},${def.color[1]},${def.color[2]},${def.color[3] / 255})`,
      textAlign: ALIGN[def.align] || 'left',
      whiteSpace: def.wordWrap ? 'pre-wrap' : 'pre',
      overflow: 'hidden',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      resize: 'none',
      userSelect: def.noSelect || !this.input ? 'none' : 'text',
      pointerEvents: this.input ? 'auto' : 'none',
    });
    if (this.input) box.style.caretColor = box.style.color;
    if (def.border) box.style.border = '1px solid #000';
    this.object.appendChild(box);
    this.el.appendChild(this.object);
    this.text = def.html ? stripTags(def.text) : def.text;
  }

  get text() {
    return this.input ? this.box.value : this.box.textContent;
  }

  /** Plain text; Flash's carriage returns become line breaks. */
  set text(value) {
    const t = String(value ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
    if (this.input) this.box.value = t;
    else this.box.textContent = t;
    this.fit();
  }

  /** Like Flash, a text field catches the mouse over its whole box unless this is turned off. */
  set mouseEnabled(on) {
    this.object.style.pointerEvents = on ? '' : 'none';
  }

  /** TextFieldAutoSize ('left', 'center', 'right'): a one-line field resizes to its text around that side. */
  set autoSize(mode) {
    this.autoSizeMode = mode;
    this.fit();
  }

  fit() {
    const mode = this.autoSizeMode;
    if (!mode || mode === 'none') return;
    const [x0, y0, x1, y1] = this.def.bounds;
    const style = this.box.style;
    const gutters = 4 + (this.def.leftMargin || 0) + (this.def.rightMargin || 0) + (this.def.indent || 0);
    const width = measureText(this.text, style.font) + gutters;
    const left = mode === 'center' ? (x0 + x1) / 2 - width / 2 : mode === 'right' ? x1 - width : x0;
    this.fitted = [left, y0, left + width, y1];
    this.object.setAttribute('x', n(left));
    this.object.setAttribute('width', n(Math.max(1, width)));
  }

  /** ActionScript's TextField.x: auto-sizing moves the field, not just its text. */
  get fieldX() {
    return this.x + ((this.fitted || this.def.bounds)[0] - this.def.bounds[0]);
  }

  set textColor(rgb) {
    this.box.style.color = '#' + rgb.toString(16).padStart(6, '0');
  }

  focus() {
    this.box.focus();
  }

  /** Add a line of text in colour runs: [[text, '#rrggbb' or null], ...]. Text is never parsed as HTML. */
  appendRuns(runs) {
    const line = document.createElementNS(XHTMLNS, 'div');
    for (const [text, color] of runs) {
      const span = document.createElementNS(XHTMLNS, 'span');
      span.textContent = text;
      if (color) span.style.color = color;
      line.appendChild(span);
    }
    this.box.appendChild(line);
    return line;
  }

  localBounds() {
    return this.fitted || this.def.bounds;
  }
}

let measureContext = null;

function measureText(text, font) {
  measureContext ||= document.createElement('canvas').getContext('2d');
  measureContext.font = font;
  measureContext.fontKerning = 'none';
  return Math.max(0, ...String(text).split('\n').map((line) => measureContext.measureText(line).width));
}

function stripTags(html) {
  const div = document.createElement('div');
  div.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
  return div.textContent || '';
}

/** The 700x490 Flash stage as an <svg> that scales with its container. */
export class Stage {
  constructor(container, width = 700, height = 490) {
    this.el = svg('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet' });
    this.el.style.display = 'block';
    this.el.style.overflow = 'hidden';
    container.appendChild(this.el);
    this.children = [];
  }

  addChild(child) {
    this.children.push(child);
    child.parent = this;
    this.el.appendChild(child.el);
    return child;
  }

  detach(child) {
    this.children = this.children.filter((c) => c !== child);
  }

  removeChild(child) {
    child.el.remove();
    this.detach(child);
    child.parent = null;
  }

  clear() {
    for (const c of this.children) c.destroy();
    this.children = [];
    this.el.replaceChildren();
  }
}
