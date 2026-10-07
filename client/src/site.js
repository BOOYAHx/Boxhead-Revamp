// Website navigation and animations only. The game loads independently on play.html.
// - The page opens like a shutter lifting; "Play" links slam it shut before the game loads.
// - Jumping to a section sweeps a three-stripe wipe across the screen.
// - A red bar slides under the current section's link; sections slide in as they appear.
// With "reduce motion" set in the system, everything happens instantly instead.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const calm = () => reduceMotion.matches;
const body = document.body;
const header = document.querySelector('.site-header');
const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#site-nav');
const links = [...document.querySelectorAll('.nav-link')];
const indicator = document.querySelector('.nav-indicator');
const wipe = document.querySelector('.wipe');
const shutter = document.querySelector('.shutter');
const progress = document.querySelector('.scroll-progress');
const heroArt = document.querySelector('.hero-art');

// --- opening -------------------------------------------------------------------------------
function open() {
  if (!body.classList.contains('is-loading')) return;
  body.classList.add('is-opening');
  body.classList.remove('is-loading');
  setTimeout(() => body.classList.remove('is-opening'), 1000);
}
const art = new Image();
art.onload = art.onerror = () => setTimeout(open, 250);
art.src = getComputedStyle(heroArt).backgroundImage.replace(/^url\(["']?|["']?\)$/g, '');
setTimeout(open, 1500); // never keep the page covered for long

// --- mobile menu -----------------------------------------------------------------------------
function closeNavigation() {
  nav.classList.remove('is-open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open navigation');
}

toggle.addEventListener('click', () => {
  const isOpen = toggle.getAttribute('aria-expanded') !== 'true';
  nav.classList.toggle('is-open', isOpen);
  toggle.setAttribute('aria-expanded', String(isOpen));
  toggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
    closeNavigation();
    toggle.focus();
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.header-inner')) closeNavigation();
});

window.matchMedia('(min-width: 1101px)').addEventListener('change', (event) => {
  if (event.matches) closeNavigation();
  moveIndicator();
});

// --- the red bar under the current section ------------------------------------------------------
function moveIndicator() {
  const active = links.find((link) => link.classList.contains('is-active'));
  if (!indicator || !active) return;
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.transform = `translateX(${active.offsetLeft}px)`;
  indicator.style.opacity = '1';
}

function setActive(id) {
  links.forEach((link) => {
    const isActive = link.getAttribute('href') === `#${id}`;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  moveIndicator();
}

if ('IntersectionObserver' in window) {
  const sections = links.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  // Track the section crossing the upper part of the viewport.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
  }, { rootMargin: '-20% 0px -60% 0px', threshold: 0 });
  sections.forEach((section) => observer.observe(section));
}
window.addEventListener('resize', moveIndicator);
document.fonts?.ready.then(moveIndicator);
moveIndicator();

// --- scrolling: header, progress bar, hero parallax --------------------------------------------
let ticking = false;
function onScroll() {
  ticking = false;
  const y = window.scrollY;
  header.classList.toggle('is-scrolled', y > 30);
  const max = document.documentElement.scrollHeight - innerHeight;
  progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
  if (!calm()) heroArt.style.setProperty('--py', `${Math.min(y * 0.25, 200)}px`);
}
window.addEventListener('scroll', () => {
  if (!ticking) requestAnimationFrame(onScroll);
  ticking = true;
}, { passive: true });
onScroll();

document.querySelector('.hero').addEventListener('pointermove', (event) => {
  if (calm() || event.pointerType !== 'mouse') return;
  const x = (event.clientX / innerWidth - 0.5) * -24;
  heroArt.style.setProperty('--px', `${x}px`);
});

// --- section wipe -----------------------------------------------------------------------------------
let wiping = false;
function jumpTo(target, hash) {
  const top = hash === '#home' ? 0 : target.getBoundingClientRect().top + window.scrollY - (header.offsetHeight + 12);
  window.scrollTo({ top, behavior: 'instant' });
  history.pushState(null, '', hash);
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const hash = link.getAttribute('href');
  const target = hash === '#' ? null : document.querySelector(hash);
  if (!target) return;
  event.preventDefault();
  closeNavigation();
  if (calm() || wiping) {
    jumpTo(target, hash);
    return;
  }
  wiping = true;
  wipe.className = 'wipe is-in';
  setTimeout(() => {
    jumpTo(target, hash);
    wipe.className = 'wipe is-out';
    setTimeout(() => {
      wipe.className = 'wipe';
      wiping = false;
    }, 600);
  }, 500);
});

// --- into the game ---------------------------------------------------------------------------------------
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-enter-game]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  if (calm()) return;
  event.preventDefault();
  closeNavigation();
  shutter.classList.add('is-closing');
  setTimeout(() => { window.location.href = link.href; }, 850);
});

// Coming back with the Back button: lift the shutter again.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  shutter.classList.remove('is-closing');
  body.classList.add('is-opening');
  setTimeout(() => body.classList.remove('is-opening'), 1000);
});

// --- reveals and counters -------------------------------------------------------------------------------
const reveals = [...document.querySelectorAll('[data-reveal]')];
// Siblings appear one after another.
for (const item of reveals) {
  const group = [...item.parentElement.children].filter((child) => child.hasAttribute('data-reveal'));
  item.style.setProperty('--delay', `${group.indexOf(item) * 0.09}s`);
}

function countUp(element) {
  const end = Number(element.dataset.count);
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / 1600);
    element.textContent = Math.round(end * (1 - (1 - k) ** 4)).toLocaleString('en-US');
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

if ('IntersectionObserver' in window && !calm()) {
  const revealer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      entry.target.querySelectorAll('[data-count]').forEach(countUp);
      revealer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  reveals.forEach((item) => revealer.observe(item));
} else {
  reveals.forEach((item) => item.classList.add('is-visible'));
}
