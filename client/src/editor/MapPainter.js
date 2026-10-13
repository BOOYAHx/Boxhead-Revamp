// Draws a map being edited with the game's own art, the way render/MapView.js
// and the shadow layer draw it in the game: ground textures tiled across the
// map, painted marks, the relief shading, prop shadows, then the props sorted
// by depth. Plain canvas, no Phaser: the editor is a page of its own.

import { CELL_HEIGHT, CELL_WIDTH, RELIEF_ALPHA, SHADOW_ALPHA } from '../game/constants.js';
import { DECALS, RELIEFS, TEXTURES, describeProp } from '../game/world.js';
import { ASSET_ROOT } from '../render/assets.js';

export { CELL_HEIGHT, CELL_WIDTH };

/** What a prop looks like and where it stands (variant 0 means "random" in the game: drawn as the first look). */
export function propLook(code, variant) {
  const desc = describeProp(code, variant || 1);
  if (!desc) return null;
  const [w, h] = desc.footprint;
  return { ...desc, width: w, height: h };
}

/** SheetDecal.draw: where cell `variant` sits on a decal sheet of `width` x `height` pixels. */
export function decalCell(width, height, variant) {
  const columns = Math.max(1, Math.round(width / CELL_WIDTH));
  const rows = Math.max(1, Math.round(height / CELL_HEIGHT));
  const v = ((variant % (columns * rows)) + columns * rows) % (columns * rows);
  return [(v % columns) * CELL_WIDTH, Math.floor(v / columns) * CELL_HEIGHT];
}

export class Art {
  constructor(onLoad) {
    this.onLoad = onLoad; // called whenever another picture arrives
    this.atlas = null;
    this.images = new Map(); // url -> HTMLImageElement (complete or loading)
  }

  async load() {
    const response = await fetch(ASSET_ROOT + 'atlas.json');
    this.atlas = await response.json();
  }

  picture(url) {
    let image = this.images.get(url);
    if (!image) {
      image = new Image();
      image.onload = () => this.onLoad?.();
      image.src = url;
      this.images.set(url, image);
    }
    return image.complete && image.naturalWidth ? image : null;
  }

  /** A ground texture, decal sheet or relief (images/). */
  image(name) {
    return name ? this.picture(ASSET_ROOT + 'images/' + name + '.png') : null;
  }

  /** Frame 0 of atlas entry `name`: { image, x, y, w, h, dx, dy } once its sheet has loaded. */
  sprite(name) {
    const entry = this.atlas?.[name];
    const frame = entry?.frames[0];
    if (!frame) return null;
    const sheet = this.picture(ASSET_ROOT + 'sprites/' + entry.image + '.png');
    if (!sheet) return null;
    const [x, y, w, h, dx, dy] = frame;
    return { image: sheet, x, y, w, h, dx, dy };
  }

  /** Draw atlas entry `name` with its origin at (px, py). */
  drawSprite(ctx, name, px, py) {
    const s = this.sprite(name);
    if (s) ctx.drawImage(s.image, s.x, s.y, s.w, s.h, px + s.dx, py + s.dy, s.w, s.h);
    return !!s;
  }

  /** A small picture of a prop for the palette. */
  propThumbnail(canvas, code, variant) {
    const look = propLook(code, variant);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = look?.display && this.sprite(look.display);
    if (!s) return false;
    const k = Math.min(1, (canvas.width - 6) / s.w, (canvas.height - 6) / s.h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(s.image, s.x, s.y, s.w, s.h, (canvas.width - s.w * k) / 2, (canvas.height - s.h * k) / 2, s.w * k, s.h * k);
    return true;
  }
}

export class MapPainter {
  constructor(art) {
    this.art = art;
    this.shadowCanvas = document.createElement('canvas');
  }

  /** The whole map onto `canvas` (sized to the map, one canvas pixel per game pixel). */
  draw(canvas, doc) {
    const W = doc.width * CELL_WIDTH;
    const H = doc.height * CELL_HEIGHT;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d');
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#' + doc.background.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, W, H);
    this.drawGround(ctx, doc);
    this.drawDecals(ctx, doc);
    const relief = this.art.image(RELIEFS[doc.relief]);
    if (relief) {
      ctx.save();
      ctx.globalAlpha = RELIEF_ALPHA;
      ctx.globalCompositeOperation = 'overlay';
      ctx.drawImage(relief, 0, 0, W, H);
      ctx.restore();
    }
    this.drawShadows(ctx, doc, W, H);
    this.drawProps(ctx, doc);
  }

  drawGround(ctx, doc) {
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        const texture = this.art.image(TEXTURES[doc.textures[y * doc.width + x]]);
        if (!texture) continue;
        const px = x * CELL_WIDTH;
        const py = y * CELL_HEIGHT;
        ctx.drawImage(texture, px % texture.width, py % texture.height, CELL_WIDTH, CELL_HEIGHT, px, py, CELL_WIDTH, CELL_HEIGHT);
      }
    }
  }

  drawDecals(ctx, doc) {
    for (const [index, { code, variant }] of doc.decals) {
      // FloorDamage is vector art the asset build does not export: the game leaves it out too.
      const sheet = DECALS[code] === 'FloorDamage' ? null : this.art.image(DECALS[code]);
      if (!sheet) continue;
      const [sx, sy] = decalCell(sheet.width, sheet.height, variant);
      ctx.drawImage(sheet, sx, sy, CELL_WIDTH, CELL_HEIGHT, (index % doc.width) * CELL_WIDTH, Math.floor(index / doc.width) * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT);
    }
  }

  /** ShadowLayer: every shadow at full strength on one layer, laid down at SHADOW_ALPHA (overlaps do not darken twice). */
  drawShadows(ctx, doc, W, H) {
    const layer = this.shadowCanvas;
    layer.width = W;
    layer.height = H;
    const sctx = layer.getContext('2d');
    for (const p of doc.props) {
      const look = propLook(p.code, p.variant);
      if (!look?.shadow) continue;
      this.art.drawSprite(sctx, look.shadow, Math.round((p.x + look.width / 2) * CELL_WIDTH), Math.round((p.y + look.height / 2) * CELL_HEIGHT));
    }
    ctx.save();
    ctx.globalAlpha = SHADOW_ALPHA;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  drawProps(ctx, doc) {
    const list = [];
    for (const p of doc.props) {
      const look = propLook(p.code, p.variant);
      if (!look?.display) continue;
      const cx = p.x + look.width / 2;
      const cy = p.y + look.height / 2;
      list.push({ look, cx, cy, depth: cy + look.depthOffset });
    }
    list.sort((a, b) => a.depth - b.depth);
    for (const { look, cx, cy } of list) this.art.drawSprite(ctx, look.display, Math.round(cx * CELL_WIDTH), Math.round(cy * CELL_HEIGHT));
  }
}
