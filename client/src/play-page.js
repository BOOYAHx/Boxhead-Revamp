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
document.addEventListener('fullscreenchange', () => {
  label.textContent = isFullscreen() ? 'Exit fullscreen' : 'Fullscreen';
  // Let the game re-fit its canvas to the new size.
  window.dispatchEvent(new Event('resize'));
});

