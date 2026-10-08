// Access to the baked sprite atlas (client/assets/game, built by
// tools/build_assets.py). Every in-game graphic is an atlas entry with one or
// more frames; each frame is a rectangle on a sheet plus the pixel offset at
// which the original game drew it relative to the thing's position.

export const ASSET_ROOT = 'assets/game/';

let atlas = null;
let hd = {}; // sheet -> scale of its upscaled copy in use (swapSheet)
let hdWanted = {}; // sheet -> scale of its upscaled copy in sprites-hd/ (tools/hd_sprites.py), loaded after start-up
let hdImages = {}; // image -> scale of its upscaled copy in images-hd/

export function setAtlas(data) {
  atlas = data;
}

/**
 * Use upscaled art (hd.json: { sprites: { sheet: 2 | 3 | 4 }, images: { name: 2 | 3 | 4 } };
 * older files list only the sheets).
 */
export function setHdSheets(map) {
  map = map || {};
  const split = map.sprites || map.images;
  hdWanted = { ...((split ? map.sprites : map) || {}) };
  hd = {};
  hdImages = (split ? map.images : null) || {};
}

/** Upscaled sheets still to load: [[sheet, scale, url]], characters first. */
export function pendingHdSheets() {
  const character = (image) => (COSTUME_SHEET.test(image) ? 0 : 1);
  return Object.entries(hdWanted)
    .filter(([image]) => !hd[image])
    .sort((a, b) => character(a[0]) - character(b[0]) || a[0].localeCompare(b[0]))
    .map(([image, scale]) => [image, scale, ASSET_ROOT + 'sprites-hd/' + image + '.png']);
}

/**
 * Replace sheet `image` with its upscaled copy (`source`, `scale` times the
 * original). Only while nothing is drawn from it: between matches.
 */
export function swapSheet(textures, image, source, scale) {
  const key = 'sheet:' + image;
  textures.remove(key);
  const texture = source instanceof HTMLCanvasElement ? textures.addCanvas(key, source) : textures.addImage(key, source);
  hd[image] = scale;
  for (const [name, entry] of Object.entries(atlas)) {
    if (entry.image !== image) continue;
    entry.frames.forEach(([x, y, w, h], index) => texture.add(`${name}:${index}`, 0, x * scale, y * scale, w * scale, h * scale));
  }
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR); // drawn smaller than its pixels
  return texture;
}

export const hdScale = (image) => hd[image] || 1;
export const hdImageScale = (name) => hdImages[name] || 1;

/** Is a loaded texture ("sheet:..." or "img:...") an upscaled copy? */
export const isHdTexture = (key) => (key.startsWith('sheet:') ? hdScale(key.slice(6)) > 1 : key.startsWith('img:') && hdImageScale(key.slice(4)) > 1);

/** Where image `name` (images/, or its upscaled copy) is loaded from. */
export const imageURL = (name) => ASSET_ROOT + (hdImages[name] ? 'images-hd/' : 'images/') + name + '.png';

export function hasSprite(name) {
  return !!atlas && name in atlas;
}

/** Frame `index` of atlas entry `name`: { image, x, y, w, h, dx, dy }, or null. */
export function frameInfo(name, index) {
  const entry = atlas?.[name];
  const frame = entry?.frames[index];
  if (!frame) return null;
  const [x, y, w, h, dx, dy] = frame;
  // x, y, w, h are in original pixels; the loaded sheet is `scale` times larger.
  return { image: entry.image, x, y, w, h, dx, dy, scale: hdScale(entry.image) };
}

export function frameCount(name) {
  return atlas?.[name]?.frames.length ?? 0;
}

// A costume's sheets (Bond: BondBody, BondBodyCustom, BondHead, BondHeadCustom)
// are drawn on top of each other, so they must all be upscaled or none.
const COSTUME_SHEET = /^(.+?)(?:Head|Body)(?:Custom)?$/;

/** Drop the HD copies of a costume that is only partly upscaled. */
export function matchCostumes(images) {
  const costumes = new Map();
  for (const image of images) {
    const costume = COSTUME_SHEET.exec(image)?.[1];
    if (costume) costumes.set(costume, [...(costumes.get(costume) || []), image]);
  }
  for (const sheets of costumes.values()) {
    if (!sheets.every((sheet) => hdWanted[sheet])) for (const sheet of sheets) delete hdWanted[sheet];
  }
}

/** Queue every sheet referenced by the atlas on a Phaser loader (the originals: HD ones follow later). */
export function loadSheets(loader) {
  const images = new Set(Object.values(atlas).map((entry) => entry.image));
  for (const image of Object.keys(hdWanted)) if (!images.has(image)) delete hdWanted[image];
  matchCostumes(images);
  for (const image of images) loader.image('sheet:' + image, ASSET_ROOT + (hd[image] ? 'sprites-hd/' : 'sprites/') + image + '.png');
}

/** Register frames named "<entry>:<index>" on the loaded sheets. */
export function registerFrames(textures) {
  for (const [name, entry] of Object.entries(atlas)) {
    const texture = textures.get('sheet:' + entry.image);
    const k = hdScale(entry.image);
    entry.frames.forEach(([x, y, w, h], index) => texture.add(`${name}:${index}`, 0, x * k, y * k, w * k, h * k));
  }
}

/**
 * Point `sprite` at frame `index` of atlas entry `name`, drawn with the
 * original offset from (x, y). Hides the sprite if the frame is missing.
 */
export function showFrame(sprite, name, index, x, y) {
  const entry = atlas[name];
  const frame = entry?.frames[index];
  if (!frame) {
    sprite.setVisible(false);
    return sprite;
  }
  sprite.setTexture('sheet:' + entry.image, `${name}:${index}`);
  sprite.setScale(1 / hdScale(entry.image));
  sprite.setPosition(x + frame[4], y + frame[5]);
  sprite.setVisible(true);
  return sprite;
}

export function createSprite(scene, name, index = 0, x = 0, y = 0) {
  const sprite = scene.add.image(0, 0, '__DEFAULT').setOrigin(0, 0);
  return showFrame(sprite, name, index, x, y);
}
