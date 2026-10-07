// The modern look of the original menus, lobby, shop and Esc menu: the same
// Flash screens and layout, regraded to match the website. Cold greys become
// warm charcoal, the grey capsule buttons become blood red, and button and
// option labels use the website's Anton lettering. The in-game HUD is left as
// it was. Everything here is applied on top of the original art, so turning a
// screen back is a matter of not calling these functions.

const SVGNS = 'http://www.w3.org/2000/svg';
export const GRADE = 'bbh-grade';
const RED = 'bbh-red';
const RED_HOT = 'bbh-red-hot';
const RED_DOWN = 'bbh-red-down';
export const DISABLED_FILTER = 'bbh-disabled';
const GOLD = 'bbh-gold';
const LABEL_FONT = '"Anton", Impact, "Arial Narrow", sans-serif';
export const ACCENT = '#e63a2c';
const LABEL_COLOR = '#ece5d8';

function el(tag, attrs, children = []) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) node.appendChild(child);
  return node;
}

/** A filter mapping brightness onto a colour ramp (dark, middle, light), each [r, g, b] 0-1. */
function rampFilter(id, [dark, mid, light]) {
  const channel = (i) => el(`feFunc${'RGB'[i]}`, { type: 'table', tableValues: `${dark[i]} ${mid[i]} ${light[i]}` });
  return el('filter', { id, x: '-10%', y: '-10%', width: '120%', height: '120%', 'color-interpolation-filters': 'sRGB' }, [
    el('feColorMatrix', { type: 'matrix', values: '.3 .59 .11 0 0  .3 .59 .11 0 0  .3 .59 .11 0 0  0 0 0 1 0' }),
    el('feComponentTransfer', {}, [0, 1, 2].map(channel)),
  ]);
}

/** Put the theme's filters next to the library's own, once. */
export function installTheme(lib) {
  if (lib.themeInstalled) return;
  lib.themeInstalled = true;
  lib.defs.append(
    // Warm, slightly darker charcoal: greys lean red-brown, mid-tones sink a little.
    el('filter', { id: GRADE, x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' }, [
      el('feColorMatrix', { type: 'matrix', values: '1.07 0 0 0 .014  0 .93 0 0 .004  0 0 .79 0 0  0 0 0 1 0' }),
      el('feComponentTransfer', {}, ['R', 'G', 'B'].map((c) => el(`feFunc${c}`, { type: 'gamma', amplitude: '1', exponent: '1.1', offset: '0' }))),
    ]),
    rampFilter(RED, [[0.3, 0.05, 0.04], [0.82, 0.16, 0.11], [1, 0.6, 0.52]]),
    rampFilter(RED_HOT, [[0.45, 0.08, 0.05], [0.95, 0.26, 0.18], [1, 0.75, 0.68]]),
    rampFilter(RED_DOWN, [[0.2, 0.03, 0.02], [0.6, 0.1, 0.07], [0.9, 0.45, 0.4]]),
    rampFilter(GOLD, [[0.07, 0.05, 0.03], [0.55, 0.38, 0.12], [1, 0.82, 0.42]]),
    rampFilter(DISABLED_FILTER, [[0.05, 0.045, 0.04], [0.24, 0.22, 0.2], [0.5, 0.47, 0.44]]),
  );
}

/** Anton capitals for a label field, a touch smaller so it keeps the original's width. */
export function themeLabel(field, { color = LABEL_COLOR, scale = 0.92 } = {}) {
  if (!field?.box || field.themed) return;
  field.themed = true;
  const style = field.box.style;
  const size = parseFloat(style.fontSize) || field.def?.size || 12;
  style.fontFamily = LABEL_FONT;
  style.fontWeight = '400';
  style.fontStyle = 'normal';
  style.fontSize = `${(size * scale).toFixed(2)}px`;
  style.letterSpacing = '0.04em';
  style.textTransform = 'uppercase';
  if (color) style.color = color;
}

/**
 * RoundLobbyButton / LobbyButton: the capsule's shapes turn blood red (brighter
 * on hover, darker pressed); the label is set in Anton.
 */
export function themeRoundButton(button, labels) {
  const states = { up: RED, over: RED_HOT, down: RED_DOWN };
  for (const [state, filter] of Object.entries(states)) {
    for (const child of button.stateChildren[state] || []) {
      if (child.box) themeLabel(child, { color: '#fff7f2' });
      else child.el.setAttribute('filter', `url(#${filter})`);
    }
  }
  labels.forEach((field) => themeLabel(field, { color: '#fff7f2' }));
}

/** TextButton (menu words such as "options", "quit", "close"): Anton, red on hover. */
export function themeTextButton(button, labels) {
  for (const field of labels) themeLabel(field, { scale: 1 });
  button.groups.up.style.opacity = '0.82'; // the original dims idle words to half; Anton needs more to read well
  for (const child of button.stateChildren.over || []) if (child.box) child.box.style.color = ACCENT;
  for (const child of button.stateChildren.down || []) if (child.box) child.box.style.color = '#ff8a7a';
}

/** Tick boxes: the box and its tick in bounty gold (call again after each tick or untick). */
export function themeTick(clip) {
  for (const child of clip.children) if (!child.box) child.el.setAttribute('filter', `url(#${GOLD})`);
}

/** Scroll bars: a red handle and arrows on the dark track. */
export function themeScrollBar(handle, arrows) {
  handle?.el.setAttribute('filter', `url(#${RED})`);
  for (const arrow of arrows) arrow?.el.setAttribute('filter', `url(#${RED})`);
}

/** Regrade a whole screen (a Flash display object or an HTML element). */
export function gradeScreen(target) {
  const node = target?.el || target;
  if (!node) return;
  if (node instanceof SVGElement) node.setAttribute('filter', `url(#${GRADE})`);
  else node.style.filter = `url(#${GRADE})`;
}
