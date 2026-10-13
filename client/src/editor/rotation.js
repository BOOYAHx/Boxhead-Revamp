// Turning things a quarter turn clockwise in the map editor. The game's art
// has no rotation, but many pieces come in turned versions: each table says
// which variant a piece becomes. Pieces that look the same from every side
// (trees, rocks, crates, building fronts...) keep theirs.

/** "code:variant" -> the variant after a quarter turn clockwise. */
const PROPS = {
  // Wooden fence: top side -> right side -> bottom -> left; corners ┌ -> ┐ -> ┘ -> └.
  'f:8': 6, 'f:6': 2, 'f:2': 4, 'f:4': 8,
  'f:7': 9, 'f:9': 3, 'f:3': 1, 'f:1': 7,
  // Brick and concrete walls: across <-> down.
  'f:11': 12, 'f:12': 11,
  'w:2': 3, 'w:3': 2,
  // Castle walls: the down pieces (6, 7 with an arrow slit) <-> the across piece (8).
  'f:26': 28, 'f:27': 28, 'f:28': 26,
  // Cars on their side (3 x 2) <-> up-down cars (2 x 3), the nearest colour (there are only three up-down ones).
  'a:1': 7, 'a:2': 8, 'a:3': 9, 'a:4': 8, 'a:5': 7, 'a:6': 9,
  'a:7': 1, 'a:8': 2, 'a:9': 6,
  // Mailboxes face four ways; the two fire hydrants are the same one turned.
  'u:21': 22, 'u:22': 23, 'u:23': 24, 'u:24': 21,
  'u:11': 12, 'u:12': 11,
};

/** Decal letter -> each cell's cell after a quarter turn (by which side of the cell the line or grass is on). */
const DECALS = {
  c: [1, 0, 2, 4, 3], // road lines: across <-> down, the cross stays, the end pieces swap
  b: [4, 4, 10, 10, 7, 1, 5, 5, 11, 11, 8, 2], // curbs: bottom -> left -> top -> right -> bottom
  e: [9, 11, 13, 15, 8, 10, 12, 14, 0, 4, 1, 5, 2, 6, 3, 7], // grass bits
  f: [5, 3, 0, 6, 1, 7, 4, 2, 10, 8, 11, 9], // grass and rock edges
};

/** Turned versions that more than one piece turns into (an up-down car, the castle wall across). */
const SHARED = new Set();
const seen = new Set();
for (const [key, variant] of Object.entries(PROPS)) {
  const turned = `${key.split(':')[0]}:${variant}`;
  (seen.has(turned) ? SHARED : seen).add(turned);
}

/**
 * The variant after a quarter turn. from: the variant it was before its last
 * turn, if it was turned; a piece several pieces turn into turns back into the
 * one it was (six car colours across, three up-down: a car keeps its colour).
 */
export function turnProp(code, variant, from) {
  if (from !== undefined && SHARED.has(`${code}:${variant}`) && PROPS[`${code}:${from}`] === variant) return from;
  return PROPS[`${code}:${variant}`] ?? variant;
}

export function turnDecal(code, variant) {
  return DECALS[code]?.[variant] ?? variant;
}

/** Whether turning changes how it looks (so the R key has something to do). */
export function turnsProp(code, variant) {
  return `${code}:${variant}` in PROPS;
}

export function turnsDecal(code, variant) {
  return DECALS[code]?.[variant] !== undefined && DECALS[code][variant] !== variant;
}
