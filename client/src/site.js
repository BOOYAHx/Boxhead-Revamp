// Website navigation only. The game loads independently on play.html.
const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#site-nav');
const links = [...document.querySelectorAll('.nav-link')];

function closeNavigation() {
  nav.classList.remove('is-open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open navigation');
}

toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  nav.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
});

nav.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeNavigation();
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

window.matchMedia('(min-width: 981px)').addEventListener('change', (event) => {
  if (event.matches) closeNavigation();
});

if ('IntersectionObserver' in window) {
  const sections = links.map((link) => document.querySelector(link.getAttribute('href')));
  // Track the section crossing the upper part of the viewport.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      links.forEach((link) => {
        const active = link.getAttribute('href') === `#${entry.target.id}`;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }
  }, { rootMargin: '-5% 0px -65% 0px', threshold: 0 });
  sections.forEach((section) => observer.observe(section));
}
