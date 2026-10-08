import { feedback } from './site-config.js';
import { feedbackTarget, patchNotes, patchDate, UPDATES_API } from './community-core.js';

const form = document.querySelector('#feedback-form');
const submit = document.querySelector('#feedback-submit');
const destination = document.querySelector('#feedback-destination');
const status = document.querySelector('#feedback-status');
const type = document.querySelector('#report-type');
const steps = document.querySelector('#report-steps');
const target = feedbackTarget(feedback);

function reportTypeChanged() {
  const isBug = type.value === 'bug';
  document.querySelector('#report-steps-label').hidden = !isBug;
  steps.disabled = !isBug;
}
type.addEventListener('change', reportTypeChanged);
reportTypeChanged();

if (target) {
  submit.disabled = false;
  if (target.mode === 'email') {
    submit.textContent = 'Open email draft';
    destination.textContent = `Opens your mail app with a report addressed to ${target.email}. Review it and press Send there.`;
  } else {
    submit.textContent = 'Send report';
    destination.textContent = 'Your report goes to the creator through the connected form service. Its confirmation opens in a new tab.';
    form.action = target.url;
    form.method = 'post';
    form.target = '_blank';
    form.setAttribute('rel', 'noopener noreferrer');
  }
}

form.addEventListener('submit', (event) => {
  status.dataset.error = 'false';
  if (!target) {
    event.preventDefault();
    status.textContent = 'The feedback inbox is not connected yet. Your report has not been sent.';
    return;
  }
  if (target.mode === 'email') {
    event.preventDefault();
    const draft = feedbackTarget(feedback, Object.fromEntries(new FormData(form)));
    if (draft.url.length > 8000) {
      status.dataset.error = 'true';
      status.textContent = 'This report is too long for an email draft link. Please shorten it, or write directly to ' + target.email + '.';
      return;
    }
    window.location.href = draft.url;
    status.textContent = 'Your email draft is ready. Complete sending in your mail app. If it did not open, email ' + target.email + ' directly.';
  } else {
    // Native POST works with form services without requiring client-side secrets
    // or CORS. Only the service can confirm delivery; never claim success here.
    status.textContent = 'Check the form-service tab for confirmation. Your text will stay here until you leave this page.';
  }
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

async function loadUpdates() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const state = document.querySelector('#updates-status');
  try {
    const response = await fetch(UPDATES_API, { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Update feed unavailable');
    const notes = patchNotes(await response.json());
    if (!notes.length) throw new Error('No patch notes');
    const entries = notes.map((note) => {
      const entry = element('article', 'patch-entry');
      const time = element('time', '', patchDate(note.date));
      time.dateTime = note.date;
      const detail = element('div');
      detail.append(element('span', 'feature-label', 'Published update'), element('h3', '', note.title));
      if (note.description) detail.append(element('p', '', note.description));
      const link = element('a', 'text-link', 'View patch ↗');
      link.href = note.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      detail.append(link); entry.append(time, detail);
      return entry;
    });
    document.querySelector('#patch-list').replaceChildren(...entries);
    state.textContent = 'Latest published changes from GitHub. Refresh this page to check for new patches.';
  } catch {
    state.textContent = 'Showing bundled patch notes. The live feed is unavailable; full update history is linked above.';
  } finally { clearTimeout(timer); }
}

loadUpdates();
