// boxhead.world.Direction: eight facings, indexed like the sprite sheets.

export class Direction {
  constructor(radians, index) {
    this.index = index;
    this.radians = radians;
    this.degrees = (radians * 180) / Math.PI;
    this.dx = Math.cos(radians);
    this.dy = Math.sin(radians);
  }
}

export const S = new Direction(Math.PI * 0.5, 0);
export const SW = new Direction(Math.PI * 0.75, 1);
export const W = new Direction(Math.PI, 2);
export const NW = new Direction(Math.PI * 1.25, 3);
export const N = new Direction(Math.PI * 1.5, 4);
export const NE = new Direction(Math.PI * 1.75, 5);
export const E = new Direction(0, 6);
export const SE = new Direction(Math.PI * 0.25, 7);
export const DIRECTIONS = [S, SW, W, NW, N, NE, E, SE];

const HOR = 0.41421356237309503; // tan(22.5°)
const VER = 2.414213562373095; // tan(67.5°)

/** Direction for an input vector (-1/0/1 on each axis), or null when idle. */
export function byVector(x, y) {
  if (x === 0) {
    if (y > 0) return S;
    if (y < 0) return N;
    return null;
  }
  const slope = y / x;
  if (x > 0) {
    if (slope > VER) return S;
    if (slope > HOR) return SE;
    if (slope > -HOR) return E;
    if (slope > -VER) return NE;
    return N;
  }
  if (slope > VER) return N;
  if (slope > HOR) return NW;
  if (slope > -HOR) return W;
  if (slope > -VER) return SW;
  return S;
}

/** A free angle (radians) for shots: same as new Direction(angle) in the original. */
export function fromAngle(radians) {
  return new Direction(radians, -1);
}
