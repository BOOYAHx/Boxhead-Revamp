// Access to the baked sprite atlas (client/assets/game, built by
// tools/build_assets.py). Every in-game graphic is an atlas entry with one or
// more frames; each frame is a rectangle on a sheet plus the pixel offset at
// which the original game drew it relative to the thing's position.

export const ASSET_ROOT = 'assets/game/';

let atlas = null;

export function setAtlas(data) {
  atlas = data;
}

export function hasSprite(name) {
  return !!atlas && name in atlas;
}

export function frameCount(name) {
  return atlas?.[name]?.frames.length ?? 0;
}

/** Queue every sheet referenced by the atlas on a Phaser loader. */
export function loadSheets(loader) {
  const images = new Set(Object.values(atlas).map((entry) => entry.image));
  for (const image of images) loader.image('sheet:' + image, ASSET_ROOT + 'sprites/' + image + '.png');
}

/** Register frames named "<entry>:<index>" on the loaded sheets. */
export function registerFrames(textures) {
  for (const [name, entry] of Object.entries(atlas)) {
    const texture = textures.get('sheet:' + entry.image);
    entry.frames.forEach(([x, y, w, h], index) => texture.add(`${name}:${index}`, 0, x, y, w, h));
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
  sprite.setPosition(x + frame[4], y + frame[5]);
  sprite.setVisible(true);
  return sprite;
}

export function createSprite(scene, name, index = 0, x = 0, y = 0) {
  const sprite = scene.add.image(0, 0, '__DEFAULT').setOrigin(0, 0);
  return showFrame(sprite, name, index, x, y);
}
