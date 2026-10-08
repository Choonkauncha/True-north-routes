import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminHashTarget } from '../lib/admin-tabs.js';
import {
  COMPLETE_RATIO,
  PLAN_FILE_LIMIT_BYTES,
  TRAINING_BUCKET_FILE_LIMIT_BYTES,
  beginView,
  canViewItem,
  classifyFile,
  cleanTrainingDraft,
  compactRanges,
  contentTypeFor,
  mergeRanges,
  notePage,
  notePlayback,
  onPause,
  onPlay,
  onSeek,
  onTime,
  parseExternalVideo,
  playbackDecision,
  progressPayload,
  slideCountFromNames,
  slideModel,
  statusLabel,
  storageLimitMessage,
  sumRanges,
  summarizeProgress,
  textFromSlideXml,
  tusEndpoint,
  uploadSizeError,
  watchCounts
} from '../lib/training-progress.js';

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations/20261008_training_practice.sql'), 'utf8');

assert.equal(COMPLETE_RATIO, 0.9);
assert.equal(PLAN_FILE_LIMIT_BYTES, 50 * 1024 * 1024);
assert.equal(TRAINING_BUCKET_FILE_LIMIT_BYTES, PLAN_FILE_LIMIT_BYTES);

function watch(seconds, step = 0.5) {
  let session = onPlay({ ranges: [], lastTime: null, playing: false }, 0);
  for (let time = step; time <= seconds + 0.001; time += step) session = onTime(session, Math.min(time, seconds));
  return onPause(session, seconds);
}

const full = watch(90);
assert.ok(Math.abs(sumRanges(full.ranges) - 90) < 0.2);
assert.equal(summarizeProgress({ ranges: full.ranges, duration: 100, kind: 'video' }).completed, true);

const almost = summarizeProgress({ ranges: [[0, 89]], duration: 100, kind: 'video', lastPosition: 89 });
assert.equal(almost.completed, false);
assert.ok(almost.percent < 90);

const seeked = onSeek(onPlay({ ranges: [], lastTime: null, playing: false }, 0), 100);
const skipped = summarizeProgress({ ranges: seeked.ranges, duration: 100, lastPosition: seeked.lastTime, kind: 'video' });
assert.equal(sumRanges(seeked.ranges), 0);
assert.equal(skipped.completed, false);
assert.equal(skipped.percent, 0);
assert.equal(skipped.lastPosition, 100);

const jumped = notePlayback({ ranges: [[0, 4]], lastTime: 4, playing: true }, 99);
assert.equal(sumRanges(jumped.ranges), 4);
assert.equal(summarizeProgress({ ranges: jumped.ranges, duration: 100, kind: 'video' }).completed, false);

const replay = sumRanges([[0, 40], [30, 55], [50, 90]]);
assert.ok(Math.abs(replay - 90) < 0.01);
assert.deepEqual(compactRanges([[0, 10.129], [10, 12]]), [[0, 12]]);

const deckPartial = summarizeProgress({ kind: 'deck', pagesViewed: [1, 2, 2], totalPages: 4, opened: true });
assert.equal(deckPartial.completed, false);
assert.equal(deckPartial.percent, 50);
assert.deepEqual(deckPartial.pages, [1, 2]);
assert.equal(summarizeProgress({ kind: 'deck', pagesViewed: [1, 2, 3, 4], totalPages: 4, opened: true }).completed, true);
assert.equal(summarizeProgress({ kind: 'pdf', pagesViewed: [1], totalPages: 3, markComplete: true, opened: false }).error, '');
assert.ok(summarizeProgress({ kind: 'pdf', pagesViewed: [], totalPages: 3, markComplete: true, opened: false }).error);
assert.equal(summarizeProgress({ kind: 'pdf', pagesViewed: [2], totalPages: 6, markComplete: true, opened: true }).completed, true);
assert.equal(summarizeProgress({ kind: 'image', pagesViewed: [1], totalPages: 1, opened: true }).completed, true);

const loom = summarizeProgress({ kind: 'external', duration: 0, markComplete: true, opened: true, openSeconds: 40 });
assert.equal(loom.completed, true);
assert.equal(summarizeProgress({ kind: 'external', duration: 120, ranges: [[0, 50]], kindFallback: true }).completed, false);
assert.equal(summarizeProgress({ kind: 'external', duration: 100, ranges: [[0, 90]] }).completed, true);

assert.deepEqual(statusLabel(null), { key: 'new', label: 'New' });
assert.equal(statusLabel({ percent: 42, started_at: '2026-10-08T00:00:00Z' }).label, 'In progress 42%');
assert.equal(statusLabel({ percent: 89.6, started_at: '2026-10-08T00:00:00Z' }).label, 'In progress 89%');
assert.equal(statusLabel({ completed_at: '2026-10-08T00:00:00Z', percent: 100 }).label, 'Completed');

const started = beginView(null, '2026-10-08T12:00:00Z');
assert.equal(started.view_count, 1);
assert.equal(beginView(started, '2026-10-08T13:00:00Z').view_count, 2);
assert.equal(beginView(started, '2026-10-08T13:00:00Z').started_at, '2026-10-08T12:00:00Z');

const setterId = '33333333-3333-4333-8333-333333333333';
assert.equal(canViewItem({ audience: 'setters', active: true }, 'appointment_setter', setterId), true);
assert.equal(canViewItem({ audience: 'setters', active: true }, 'canvasser', setterId), true);
assert.equal(canViewItem({ audience: 'reps', active: true }, 'appointment_setter', setterId), false);
assert.equal(canViewItem({ audience: 'reps', active: true, assigneeIds: [setterId] }, 'appointment_setter', setterId), true);
assert.equal(canViewItem({ audience: 'specific', active: true, assigneeIds: [] }, 'salesperson', 'x'), false);
assert.equal(canViewItem({ audience: 'both', active: false }, 'salesperson', 'x'), false);
assert.equal(canViewItem({ audience: 'both', active: false }, 'admin', 'x'), true);

assert.equal(uploadSizeError(50 * 1024 * 1024), '');
assert.match(uploadSizeError(50 * 1024 * 1024 + 1), /50 MB/);
assert.match(uploadSizeError(80 * 1024 * 1024), /Free plan/);
assert.match(storageLimitMessage({ message: 'The object exceeded the maximum allowed size' }, 60 * 1024 * 1024), /50 MB/);
assert.equal(storageLimitMessage({ message: 'network down' }, 10), '');

assert.equal(classifyFile('clip.MOV', ''), 'video');
assert.equal(classifyFile('deck.pptx', ''), 'deck');
assert.equal(classifyFile('notes.pdf', ''), 'pdf');
assert.equal(classifyFile('photo.HEIC', ''), 'image');
assert.equal(classifyFile('nope.zip', ''), '');
assert.equal(contentTypeFor('clip.mov', 'video'), 'video/quicktime');
assert.deepEqual(playbackDecision({ extension: 'mov', canPlayType: 'maybe', videoWidth: 1920, played: true }), { action: 'play-as-mp4', contentType: 'video/mp4' });
assert.equal(playbackDecision({ extension: 'mov', canPlayType: '', videoWidth: 0, played: false }).action, 'transcode');
assert.equal(playbackDecision({ extension: 'mp4', canPlayType: 'probably', videoWidth: 1280, played: true }).action, 'keep');
assert.equal(playbackDecision({ extension: 'webm', canPlayType: 'maybe', videoWidth: 0, played: false }).action, 'transcode');

assert.equal(tusEndpoint('https://qdovtewieuojjsebipex.supabase.co'), 'https://qdovtewieuojjsebipex.storage.supabase.co/storage/v1/upload/resumable');

const youtube = parseExternalVideo('https://www.youtube.com/watch?v=abc_def-123');
assert.equal(youtube.provider, 'youtube');
assert.match(youtube.embedUrl, /youtube-nocookie.com\/embed\/abc_def-123/);
assert.equal(parseExternalVideo('https://youtu.be/abc_def-123').id, 'abc_def-123');
assert.equal(parseExternalVideo('https://vimeo.com/123456789').provider, 'vimeo');
assert.equal(parseExternalVideo('https://www.loom.com/share/0123456789abcdef0123456789abcdef').provider, 'loom');
assert.equal(parseExternalVideo('https://example.com/video'), null);

assert.deepEqual(textFromSlideXml('<a:t>Find the homeowner</a:t><a:t>Book a time</a:t>'), ['Find the homeowner', 'Book a time']);
const model = slideModel(
  '<p:pic><a:blip r:embed="rId2"/></p:pic><a:t>Title</a:t>',
  '<Relationship Id="rId2" Target="../media/image1.png"/>'
);
assert.deepEqual(model.texts, ['Title']);
assert.deepEqual(model.imageTargets, ['../media/image1.png']);
assert.equal(slideCountFromNames(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slideLayouts/slideLayout1.xml']), 2);

assert.equal(cleanTrainingDraft({ title: 'Hi', audience: 'both' }).error.includes('file'), true);
assert.equal(cleanTrainingDraft({ title: 'Inspection', audience: 'specific', assigneeIds: [], externalUrl: 'https://youtu.be/abc_def-123' }).error.includes('person'), true);
const draft = cleanTrainingDraft({ title: 'Inspection', audience: 'both', externalUrl: 'https://youtu.be/abc_def-123' });
assert.equal(draft.external.provider, 'youtube');
const tooBig = cleanTrainingDraft({ title: 'Inspection', audience: 'reps', file: { name: 'a.mp4', type: 'video/mp4', size: 60 * 1024 * 1024 } });
assert.match(tooBig.error, /50 MB/);

const paged = notePage({ pages: [1] }, 3, 4);
assert.deepEqual(paged.pages, [1, 3]);
assert.deepEqual(watchCounts([
  { view_count: 1, percent: 10 },
  { completed_at: '2026-10-08T00:00:00Z', view_count: 1 },
  {}
]), { watched: 2, completed: 1 });

const row = progressPayload({
  repId: 'rep',
  item: { id: 'item', kind: 'video', duration_seconds: 100 },
  session: { ranges: [[0, 10]], lastTime: 10, pages: [] },
  saved: { started_at: '2026-10-08T00:00:00Z', view_count: 1 },
  now: '2026-10-08T00:01:00Z'
});
assert.equal(row.row.completed_at, null);
assert.equal(row.row.max_watched_seconds, 10);
assert.equal(row.row.rep_id, 'rep');

assert.deepEqual(mergeRanges([[5, 1], [1, 2]]), [[1, 5]]);
assert.equal(adminHashTarget('#training').tab, 'training');

assert.ok(sql.includes('training_items'));
assert.ok(sql.includes('training_assignments'));
assert.ok(sql.includes('training_progress'));
assert.ok(sql.includes('training_reminders'));
assert.ok(sql.includes("'training'"));
assert.ok(sql.includes('52428800'));
assert.ok(sql.includes('is_admin_or_manager()'));
assert.ok(sql.includes('current_rep_id()'));
assert.ok(sql.includes('current_rep_role()'));
assert.ok(sql.includes('enable row level security'));
assert.ok(sql.includes('training_storage_select'));
assert.ok(sql.includes('training_storage_insert'));
assert.ok(sql.includes('training_storage_update'));
assert.ok(sql.includes('training_storage_delete'));
assert.ok(sql.includes('video/mp4'));
assert.ok(sql.includes('video/quicktime'));
assert.ok(sql.includes('presentationml.presentation'));
assert.equal(sql.includes('create policy training_items_select'), true);
assert.equal((sql.match(/drop policy if exists/g) || []).length > 5, true);

console.log('training-progress tests ok');
