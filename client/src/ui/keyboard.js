import { ACTIONS, isKey } from '../game/controls.js';

const editable = (element) => !!(element?.isContentEditable || element?.closest?.('input, textarea, select'));
const gameKey = (code) => [13, 27, 192].includes(code) || ACTIONS.some((action) => isKey(action, code));

/** Keep game keys in the console, after Phaser has received the DOM event. */
export function keepConsoleKeys(stage, { playing = () => false, target = window, document: doc = stage.ownerDocument } = {}) {
  let owned = stage.contains(doc.activeElement) || doc.activeElement === doc.body;
  const focus = () => stage.focus({ preventScroll: true });
  const onFocus = (event) => { owned = stage.contains(event.target); };
  const onPointer = (event) => { owned = stage.contains(event.target); };
  const onClick = (event) => {
    if (stage.contains(event.target) && !editable(event.target)) focus();
  };
  const onKey = (event) => {
    const active = doc.activeElement;
    if (!stage.contains(active) && !(owned && active === doc.body)) return;
    // A screen transition can remove the focused input. Give focus back to the console.
    if (active === doc.body) focus();
    if (event.defaultPrevented) return; // login fields / key rebinding already handled it
    const typing = editable(active) || editable(event.target);
    if (event.key === 'Tab' || event.keyCode === 9) {
      event.preventDefault(); // every repeat, including Shift+Tab
      if (playing() && !typing) {
        focus(); // Tab still reaches KeyState for the scoreboard; it never changes page focus
        return;
      }
      // Login and other native menu controls can cycle, but only inside the console.
      const fields = [...stage.querySelectorAll('input, textarea, select, button, a[href], [tabindex], [contenteditable]')]
        .filter((el) => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden], [aria-hidden="true"]')
          && el.getClientRects().length && doc.defaultView.getComputedStyle(el).visibility !== 'hidden');
      if (!fields.length) return focus();
      const index = fields.indexOf(active);
      const next = index < 0 ? (event.shiftKey ? fields.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + fields.length) % fields.length;
      fields[next].focus({ preventScroll: true });
    } else if (playing() && !typing && gameKey(event.keyCode)) {
      // Includes rebound keys and modifier combinations such as Shift+Space / Ctrl+R.
      event.preventDefault();
    }
  };
  // Bubble phase is intentional: preventing earlier would make Phaser skip the event.
  target.addEventListener('keydown', onKey);
  target.addEventListener('focusin', onFocus);
  target.addEventListener('pointerdown', onPointer);
  stage.addEventListener('click', onClick);
  if (owned && doc.activeElement === doc.body) focus();
  return () => {
    target.removeEventListener('keydown', onKey);
    target.removeEventListener('focusin', onFocus);
    target.removeEventListener('pointerdown', onPointer);
    stage.removeEventListener('click', onClick);
  };
}
