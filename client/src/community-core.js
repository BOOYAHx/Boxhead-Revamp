export const REPOSITORY = 'https://github.com/BOOYAHx/Boxhead-Revamp';
export const UPDATES_API = 'https://api.github.com/repos/BOOYAHx/Boxhead-Revamp/commits?sha=boxhead-revamp&per_page=6';

export function feedbackTarget(config, report = {}) {
  if (config.mode === 'email') {
    const email = String(config.email || '').trim();
    if (!/^[^\s@?#&%<>:]+@[^\s@?#&%<>:]+\.[^\s@?#&%<>:]+$/.test(email)) return null;
    const kind = report.type === 'feedback' ? 'Feedback' : 'Bug report';
    const body = [report.details || '', report.type === 'bug' && report.steps ? 'Steps to reproduce:\n' + report.steps : '', report.browser ? 'Browser / device: ' + report.browser : ''].filter(Boolean).join('\n\n');
    const url = `mailto:${email}?subject=${encodeURIComponent('[Boxhead ' + kind + '] ' + (report.title || ''))}&body=${encodeURIComponent(body)}`;
    return { mode: 'email', url, email };
  }
  if (config.mode === 'form') {
    try {
      const url = new URL(config.endpoint);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      return { mode: 'form', url: url.href };
    } catch { return null; }
  }
  return null;
}

/** Treat all repository messages as text; strip attribution from the public preview. */
export function patchNotes(commits) {
  if (!Array.isArray(commits)) return [];
  return commits.flatMap((entry) => {
    if (!/^[0-9a-f]{40}$/.test(entry?.sha) || typeof entry.commit?.message !== 'string') return [];
    const date = new Date(entry.commit.committer?.date || entry.commit.author?.date);
    if (!Number.isFinite(date.getTime())) return [];
    const [title, ...lines] = entry.commit.message.split('\n');
    const body = lines.join('\n').split(/\n?(?:Co-Authored-By:|Claude-Session:)/i)[0].trim();
    return [{ title: title.slice(0, 200), description: body.length > 600 ? body.slice(0, 597) + '…' : body, date: date.toISOString(), href: REPOSITORY + '/commit/' + entry.sha }];
  }).slice(0, 6);
}

export function patchDate(date) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Amman' }).format(new Date(date));
}
