// Particle textures made once at start-up: the original's vector smoke and
// blood shapes and the flamer's fire (fx.json from the asset build) drawn
// into bitmaps the way Smoke, Blood.prerender and FireRenderer did, plus a few
// soft shapes for the enhanced effects (glow, spark).

const BLOOD_COLOR = [0x90, 0x02, 0x04]; // Blood.COLOR
const BLOOD_ALPHA = 0.1; // Blood.ALPHA

/** Flash blur sizes are box widths; this is the Gaussian of similar width. */
const blurDeviation = (size) => Math.sqrt(Math.max(0, (size * size - 1) / 12));

function loadSvg(markup) {
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  return image.decode().then(() => image);
}

/** Smooth fractal value noise in 0..1, like BitmapData.perlinNoise(4, 4, 3, seed, false, true). */
export function fractalNoise(width, height, base = 4, octaves = 3, random = Math.random) {
  const out = new Float32Array(width * height);
  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const step = base / 2 ** o;
    const gw = Math.ceil(width / step) + 2;
    const gh = Math.ceil(height / step) + 2;
    const grid = Float32Array.from({ length: gw * gh }, () => random());
    const smooth = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < height; y++) {
      const gy = y / step;
      const y0 = Math.floor(gy);
      const ty = smooth(gy - y0);
      for (let x = 0; x < width; x++) {
        const gx = x / step;
        const x0 = Math.floor(gx);
        const tx = smooth(gx - x0);
        const a = grid[y0 * gw + x0] + (grid[y0 * gw + x0 + 1] - grid[y0 * gw + x0]) * tx;
        const b = grid[(y0 + 1) * gw + x0] + (grid[(y0 + 1) * gw + x0 + 1] - grid[(y0 + 1) * gw + x0]) * tx;
        out[y * width + x] += (a + (b - a) * ty) * amplitude;
      }
    }
    total += amplitude;
    amplitude /= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * Blood.prerender: noise, with the frame drawn over it (a black sheet with the
 * splat cut out), becomes the alpha of a blood-coloured bitmap at 10%.
 */
async function bloodTextures(scene, blood, res) {
  const [x0, y0, x1, y1] = blood.bounds;
  const width = Math.round((x1 - x0) * res);
  const height = Math.round((y1 - y0) * res);
  const keys = [];
  for (const [index, markup] of blood.frames.entries()) {
    const image = await loadSvg(markup);
    const key = 'fx:blood' + index;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const canvas = scene.textures.createCanvas(key, width, height);
    const ctx = canvas.getContext();
    const noise = fractalNoise(width, height, 4 * res);
    const data = ctx.createImageData(width, height);
    for (let i = 0; i < noise.length; i++) {
      const v = Math.round(noise[i] * 255);
      data.data.set([v, v, v, 255], i * 4);
    }
    ctx.putImageData(data, 0, 0);
    ctx.drawImage(image, 0, 0, width, height);
    const mixed = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < mixed.data.length; i += 4) {
      const alpha = mixed.data[i + 2] * BLOOD_ALPHA;
      mixed.data.set([...BLOOD_COLOR, Math.round(alpha)], i);
    }
    ctx.putImageData(mixed, 0, 0);
    canvas.refresh();
    keys.push(key);
  }
  return keys;
}

/** Smoke graphics: the soft white streak, blurred, one texture per frame. */
async function smokeTextures(scene, smoke, res) {
  const [x0, y0, x1, y1] = smoke.bounds;
  const sigma = blurDeviation(smoke.blur);
  const pad = Math.ceil(sigma * 3);
  const width = (Math.ceil(x1 - x0) + pad * 2) * res;
  const height = (Math.ceil(y1 - y0) + pad * 2) * res;
  const frames = [];
  for (const [index, markup] of smoke.frames.entries()) {
    const image = await loadSvg(markup);
    const key = 'fx:smoke' + index;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const canvas = scene.textures.createCanvas(key, width, height);
    const ctx = canvas.getContext();
    ctx.filter = `blur(${sigma * res}px)`;
    ctx.globalAlpha = smoke.alpha;
    ctx.drawImage(image, pad * res, pad * res, (x1 - x0) * res, (y1 - y0) * res);
    canvas.refresh();
    // The shape's own origin (0, 0) inside the padded texture; sizes in game pixels, `res` texture pixels each.
    frames.push({ key, originX: ((pad - x0) * res) / width, originY: ((pad - y0) * res) / height, pad: pad - x0, graphicWidth: x1 - x0, height: height / res, res });
  }
  return frames;
}

function radialTexture(scene, key, size, stops) {
  if (scene.textures.exists(key)) return;
  const canvas = scene.textures.createCanvas(key, size, size);
  const ctx = canvas.getContext();
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  canvas.refresh();
}

// FireRenderer: each flame is ten FireLayers, the soft blob tinted white to
// orange to nothing over 75 frames, drifting up, growing and turning; added
// together and recorded every 5 steps. Three sizes, four variants each.
const FIRE_LAYERS = 10;
const FIRE_ADD_TIME = 4;
const FIRE_VARIANTS = 4;
const FIRE_SIZES = 3;
const FIRE_STEPS_PER_FRAME = 5;

class FireLayer {
  constructor(random) {
    this.rotation = random() * 360;
    const scaleX = 0.5 + random() * 0.5;
    this.scaleY = 0.5 + random() * 0.5;
    this.scaleX = scaleX;
    this.dRot = random() - 0.5;
    this.dScale = random() * 0.4 + 1.6;
    this.dPos = { x: random() * 16 - 8, y: (-50 * 28) / 40 };
    this.x = 0;
    this.y = 0;
    this.frame = 0;
  }

  get finished() {
    return this.frame >= this.lastFrame;
  }

  process() {
    this.rotation += this.dRot;
    this.scaleX += (this.dScale - this.scaleX) * 0.1;
    this.scaleY = this.scaleX;
    this.x += this.dPos.x;
    this.y += this.dPos.y;
    this.dRot *= 1.1;
    const length = Math.hypot(this.dPos.x, this.dPos.y);
    if (length > 0) {
      const k = (length * 0.99) / length;
      this.dPos.x *= k;
      this.dPos.y *= k;
    }
    this.dPos.y -= 0.5;
    this.frame++;
  }

  /** Layer matrix [a, b, c, d, tx, ty] inside the container scaled by `scale`. */
  matrix(scale, offset) {
    const r = (this.rotation * Math.PI) / 180;
    const a = Math.cos(r) * this.scaleX;
    const b = Math.sin(r) * this.scaleX;
    const c = -Math.sin(r) * this.scaleY;
    const d = Math.cos(r) * this.scaleY;
    return [a * scale, b * scale, c * scale, d * scale, (this.x + a * offset[0] + c * offset[1]) * scale, (this.y + b * offset[0] + d * offset[1]) * scale];
  }
}

/** The blob under each frame's colour transform (colour from the offsets, alpha scaled). */
function tintedBlobs(image, colors) {
  const w = image.width;
  const h = image.height;
  const source = document.createElement('canvas');
  source.width = w;
  source.height = h;
  const sctx = source.getContext('2d');
  sctx.drawImage(image, 0, 0);
  const pixels = sctx.getImageData(0, 0, w, h).data;
  return colors.map(([mul, add]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(w, h);
    for (let i = 0; i < pixels.length; i += 4) {
      const a = pixels[i + 3];
      if (!a) continue;
      const channel = (k) => Math.max(0, Math.min(255, pixels[i + k] * mul[k] + add[k]));
      out.data[i] = channel(0);
      out.data[i + 1] = channel(1);
      out.data[i + 2] = channel(2);
      out.data[i + 3] = Math.max(0, Math.min(255, a * mul[3] + add[3]));
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  });
}

/** One FireRenderer run: its frames as canvases with the top-left offset of each. */
function renderFire(size, blobs, rect, offset, random, res) {
  const scale = (0.014 + 0.002 * size) * res;
  const lastFrame = blobs.length - 1;
  const layers = [];
  const frames = [];
  let spawned = 0;
  let addTime = FIRE_ADD_TIME;
  const corners = [
    [rect[0], rect[1]],
    [rect[2], rect[1]],
    [rect[0], rect[3]],
    [rect[2], rect[3]],
  ];
  do {
    for (let step = 0; step < FIRE_STEPS_PER_FRAME; step++) {
      if (spawned < FIRE_LAYERS && --addTime === 0) {
        addTime = FIRE_ADD_TIME;
        const layer = new FireLayer(random);
        layer.lastFrame = lastFrame;
        layers.unshift(layer); // addChildAt(layer, 0): new layers go underneath
        spawned++;
      }
      for (let i = layers.length - 1; i >= 0; i--) {
        layers[i].process();
        if (layers[i].finished) layers.splice(i, 1);
      }
    }
    if (!layers.length) continue;
    const matrices = layers.map((layer) => layer.matrix(scale, offset));
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const m of matrices) {
      for (const [px, py] of corners) {
        const x = m[0] * px + m[2] * py + m[4];
        const y = m[1] * px + m[3] * py + m[5];
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(x1 - x0));
    canvas.height = Math.max(1, Math.ceil(y1 - y0));
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'lighter'; // FireLayer.blendMode = "add"
    layers.forEach((layer, i) => {
      const m = matrices[i];
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4] - x0, m[5] - y0);
      ctx.drawImage(blobs[Math.min(layer.frame, lastFrame)], rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
    });
    frames.push({ canvas, x: x0, y: y0 });
  } while (layers.length > 0 || spawned < FIRE_LAYERS);
  return frames;
}

/**
 * Fire.displays: [size][variant] -> frames { key, frame, dx, dy } on one
 * packed texture "fx:fire".
 */
async function fireTextures(scene, fire, res, random = Math.random) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = fire.image;
  });
  const blobs = tintedBlobs(image, fire.colors);
  const runs = [];
  for (let size = 0; size < FIRE_SIZES; size++) {
    runs.push(Array.from({ length: FIRE_VARIANTS }, () => renderFire(size, blobs, fire.rect, fire.offset, random, res)));
  }
  // Pack every frame onto one canvas, a shelf per run.
  const all = runs.flat();
  const width = Math.min(2048, Math.max(...all.map((frames) => frames.reduce((sum, f) => sum + f.canvas.width + 1, 0))));
  let x = 0;
  let y = 0;
  let shelf = 0;
  const placed = all.map((frames) =>
    frames.map((f) => {
      if (x + f.canvas.width > width) {
        x = 0;
        y += shelf + 1;
        shelf = 0;
      }
      const spot = { ...f, px: x, py: y };
      x += f.canvas.width + 1;
      shelf = Math.max(shelf, f.canvas.height);
      return spot;
    }),
  );
  const key = 'fx:fire';
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const texture = scene.textures.createCanvas(key, width, y + shelf + 1);
  const ctx = texture.getContext();
  let n = 0;
  const displays = placed.map((frames) =>
    frames.map((f) => {
      ctx.drawImage(f.canvas, f.px, f.py);
      const name = 'f' + n++;
      texture.add(name, 0, f.px, f.py, f.canvas.width, f.canvas.height);
      return { key, frame: name, dx: f.x / res, dy: f.y / res, res };
    }),
  );
  texture.refresh();
  return Array.from({ length: FIRE_SIZES }, (_, size) => displays.slice(size * FIRE_VARIANTS, (size + 1) * FIRE_VARIANTS));
}

/**
 * Build everything at `res` texture pixels per game pixel (the drawing scale,
 * so they stay sharp with Enhanced Graphics); returns { blood: [keys], smoke: [frames], fire: [size][variant][frames] } (empty when fx.json lacks them). */
export async function buildFxTextures(scene, fx, res = 1) {
  res = Math.max(1, Math.round(res));
  radialTexture(scene, 'fx:glow', 128, [
    [0, 'rgba(255,255,255,1)'],
    [0.25, 'rgba(255,255,255,0.45)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  radialTexture(scene, 'fx:spark', 8, [
    [0, 'rgba(255,255,255,1)'],
    [0.5, 'rgba(255,255,255,0.8)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  const result = { blood: [], smoke: [], fire: [], bloodRes: res };
  try {
    if (fx?.blood) result.blood = await bloodTextures(scene, fx.blood, res);
    if (fx?.smoke) result.smoke = await smokeTextures(scene, fx.smoke, res);
    if (fx?.fire) result.fire = await fireTextures(scene, fx.fire, res);
  } catch (error) {
    console.warn('Particle shapes could not be drawn:', error);
  }
  return result;
}
