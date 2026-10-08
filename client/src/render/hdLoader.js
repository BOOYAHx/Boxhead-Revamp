// The upscaled sprite sheets (Enhanced Graphics), loaded after the game has
// started. Loading every one of them before the menu took a long time and a
// lot of graphics memory, so the game starts with the original art and swaps
// in each HD sheet once it has downloaded, one at a time, and only between
// matches (nothing is drawing from the sheets then). A sheet larger than the
// screen can show is shrunk first, which saves most of the memory.

import { pendingHdSheets, swapSheet } from './assets.js';
import { Display } from './display.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** `img` at `to` times the original size when its own `from` is more than needed. */
export function shrink(img, from, to) {
  if (to >= from) return img;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((img.naturalWidth * to) / from);
  canvas.height = Math.round((img.naturalHeight * to) / from);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The HD scale worth keeping on this screen: the drawing scale, at least 2. */
export const usefulScale = (scale) => Math.min(scale, Math.max(2, Display.scale));

/**
 * Swap in every upscaled sheet. `busy()` is true while a match is running.
 * Returns how many sheets were swapped.
 */
export async function loadHdSheets(game, busy) {
  let done = 0;
  for (const [image, scale, url] of pendingHdSheets()) {
    let img;
    try {
      img = await loadImage(url);
    } catch {
      continue; // missing or broken: that sheet keeps the original art
    }
    while (busy()) await wait(1000);
    const keep = usefulScale(scale);
    swapSheet(game.textures, image, shrink(img, scale, keep), keep);
    done++;
    await wait(0); // let a frame through between sheets
  }
  return done;
}
