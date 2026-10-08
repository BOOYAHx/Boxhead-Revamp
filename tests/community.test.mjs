import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackTarget, patchNotes, patchDate } from '../client/src/community-core.js';

test('feedback remains unavailable until a valid delivery destination is configured', () => {
  assert.equal(feedbackTarget({ mode: 'pending' }), null);
  assert.equal(feedbackTarget({ mode: 'email', email: '' }), null);
  assert.equal(feedbackTarget({ mode: 'email' }), null);
  assert.equal(feedbackTarget({ mode: 'email', email: 'owner%0acc@example.com' }), null);
  assert.equal(feedbackTarget({ mode: 'email', email: 'owner@example.com\nBcc:someone' }), null);
  assert.equal(feedbackTarget({ mode: 'form', endpoint: 'javascript:alert(1)' }), null);
  assert.equal(feedbackTarget({ mode: 'form', endpoint: 'https://secret:password@example.com/report' }), null);
  assert.deepEqual(feedbackTarget({ mode: 'form', endpoint: 'https://example.com/report' }), { mode: 'form', url: 'https://example.com/report' });
});

test('email drafts preserve report content without turning user text into recipient/query fields', () => {
  const report = { type: 'bug', title: 'Crates & movement? #1', details: 'مرحبا\nA & B = C? <test>', steps: '1. Move\n2. Fire', browser: 'Firefox / Windows' };
  const draft = feedbackTarget({ mode: 'email', email: 'creator@example.com' }, report);
  const url = new URL(draft.url);
  assert.equal(url.protocol, 'mailto:');
  assert.equal(url.pathname, 'creator@example.com');
  assert.equal(url.searchParams.get('subject'), '[Boxhead Bug report] ' + report.title);
  assert.equal(url.searchParams.get('body'), report.details + '\n\nSteps to reproduce:\n' + report.steps + '\n\nBrowser / device: ' + report.browser);
  assert.deepEqual([...url.searchParams.keys()], ['subject', 'body']);
});

test('feedback drafts omit stale bug reproduction steps after changing report type', () => {
  const draft = feedbackTarget({ mode: 'email', email: 'creator@example.com' }, { type: 'feedback', title: 'An idea', details: 'More maps', steps: 'Old bug steps' });
  const params = new URL(draft.url).searchParams;
  assert.equal(params.get('body'), 'More maps');
  assert.equal(params.get('subject'), '[Boxhead Feedback] An idea');
});

test('patch feed ignores malformed records, limits results and uses trusted repository links', () => {
  const entry = { sha: 'a'.repeat(40), html_url: 'javascript:alert(1)', commit: { message: 'Fixed movement\n\nRestores sliding.\n\nCo-Authored-By: Example\nClaude-Session: ignored', committer: { date: '2026-10-07T23:55:18Z' } } };
  const notes = patchNotes([null, {}, { ...entry, sha: '<script>' }, ...Array(8).fill(entry)]);
  assert.equal(notes.length, 6);
  assert.equal(notes[0].description, 'Restores sliding.');
  assert.equal(notes[0].href, 'https://github.com/BOOYAHx/Boxhead-Revamp/commit/' + 'a'.repeat(40));
  assert.deepEqual(patchNotes({ message: 'rate limited' }), []);
  assert.deepEqual(patchNotes([{ ...entry, commit: { ...entry.commit, committer: { date: 'bad' } } }]), []);
});

test('patch dates match the project owner time zone', () => {
  assert.equal(patchDate('2026-10-07T23:55:18Z'), '08 Oct 2026');
});
