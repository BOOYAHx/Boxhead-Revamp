// The game page around the game: the fullscreen button. (The game itself is src/main.js.)
const stage = document.getElementById('play-stage');
const button = document.getElementById('play-fullscreen');
const label = button.querySelector('span');

const isFullscreen = () => document.fullscreenElement === stage;
button.hidden = !stage.requestFullscreen;
button.addEventListener('click', () => {
  if (isFullscreen()) document.exitFullscreen();
  else stage.requestFullscreen?.().catch(() => {});
  stage.focus({ preventScroll: true }); // return gameplay keys to the console after fullscreen
});
// In fullscreen, keep browser shortcuts such as Ctrl+W (close the tab: Ctrl is Auto-run and W
// is up), Ctrl+T, Ctrl+R or Ctrl+Tab for the game (Keyboard Lock, Chrome and Edge). Esc is left
// out so it still leaves fullscreen at once. Outside fullscreen no page can stop Ctrl+W.
const LOCKED_KEYS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => 'Key' + c),
  ...'0123456789'.split('').map((d) => 'Digit' + d),
  'Tab', 'Space', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash',
  'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Delete',
];
function lockKeys(on) {
  const keyboard = navigator.keyboard;
  if (!keyboard?.lock) return;
  if (on) keyboard.lock(LOCKED_KEYS).catch(() => {});
  else keyboard.unlock();
}

document.addEventListener('fullscreenchange', () => {
  lockKeys(isFullscreen());
  label.textContent = isFullscreen() ? 'Exit fullscreen' : 'Fullscreen';
  // Let the game re-fit its canvas to the new size.
  window.dispatchEvent(new Event('resize'));
});

