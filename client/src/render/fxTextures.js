// Particle textures made once at start-up: the original's vector smoke and
// blood shapes (fx.json from the asset build) drawn into bitmaps the way
// Smoke and Blood.prerender did, plus a few soft shapes for the enhanced
// effects (glow, spark).

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
async function bloodTextures(scene, blood) {
  const [x0, y0, x1, y1] = blood.bounds;
  const width = Math.round(x1 - x0);
  const height = Math.round(y1 - y0);
  const keys = [];
  for (const [index, markup] of blood.frames.entries()) {
    const image = await loadSvg(markup);
    const key = 'fx:blood' + index;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const canvas = scene.textures.createCanvas(key, width, height);
    const ctx = canvas.getContext();
    const noise = fractalNoise(width, height);
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
async function smokeTextures(scene, smoke) {
  const [x0, y0, x1, y1] = smoke.bounds;
  const sigma = blurDeviation(smoke.blur);
  const pad = Math.ceil(sigma * 3);
  const width = Math.ceil(x1 - x0) + pad * 2;
  const height = Math.ceil(y1 - y0) + pad * 2;
  const frames = [];
  for (const [index, markup] of smoke.frames.entries()) {
    const image = await loadSvg(markup);
    const key = 'fx:smoke' + index;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const canvas = scene.textures.createCanvas(key, width, height);
    const ctx = canvas.getContext();
    ctx.filter = `blur(${sigma}px)`;
    ctx.globalAlpha = smoke.alpha;
    ctx.drawImage(image, pad, pad, x1 - x0, y1 - y0);
    canvas.refresh();
    // The shape's own origin (0, 0) inside the padded texture.
    frames.push({ key, originX: (pad - x0) / width, originY: (pad - y0) / height, pad: pad - x0, graphicWidth: x1 - x0, height });
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

/** Build everything; returns { blood: [keys], smoke: [frames] } (empty lists when fx.json is missing). */
export async function buildFxTextures(scene, fx) {
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
  const result = { blood: [], smoke: [] };
  try {
    if (fx?.blood) result.blood = await bloodTextures(scene, fx.blood);
    if (fx?.smoke) result.smoke = await smokeTextures(scene, fx.smoke);
  } catch (error) {
    console.warn('Particle shapes could not be drawn:', error);
  }
  return result;
}
