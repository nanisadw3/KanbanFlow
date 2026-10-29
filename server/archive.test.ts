import { test } from 'node:test';
import assert from 'node:assert/strict';
// Same convention as dates.test.ts: src/ has no Node types, so the test lives here.
import { isLive, isDoneVisibleOnBoard, inArchivero, matchesTab, archiveTabCounts, matchesArchiveView, archiveViewCounts } from '../src/archive.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-16T12:00:00Z');
const t = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'x', status, archived: false, ...extra }) as any;

test('isLive: archivadas abiertas salen de las vistas vivas; hechas/canceladas siguen contando', () => {
  assert.equal(isLive(t('todo')), true);
  assert.equal(isLive(t('todo', { archived: true })), false);
  assert.equal(isLive(t('doing', { archived: true })), false);
  assert.equal(isLive(t('done', { archived: true })), true);
  assert.equal(isLive(t('cancelled', { archived: true })), true);
});

test('isDoneVisibleOnBoard: reciente o sin completedAt; archivada nunca', () => {
  assert.equal(isDoneVisibleOnBoard(t('done', { completedAt: new Date(now - DAY / 2).toISOString() }), now), true);
  assert.equal(isDoneVisibleOnBoard(t('done', { completedAt: new Date(now - 2 * DAY).toISOString() }), now), false);
  assert.equal(isDoneVisibleOnBoard(t('done'), now), true); // datos antiguos sin completedAt
  assert.equal(isDoneVisibleOnBoard(t('done', { archived: true, completedAt: new Date(now).toISOString() }), now), false);
});

test('inArchivero: archivadas de cualquier estado, todas las canceladas y las hechas con más de un día', () => {
  assert.equal(inArchivero(t('todo', { archived: true }), now), true);
  assert.equal(inArchivero(t('doing', { archived: true }), now), true);
  assert.equal(inArchivero(t('cancelled'), now), true);
  assert.equal(inArchivero(t('done', { completedAt: new Date(now - 2 * DAY).toISOString() }), now), true);
  assert.equal(inArchivero(t('done', { completedAt: new Date(now - 1000).toISOString() }), now), false);
  assert.equal(inArchivero(t('todo'), now), false);
  assert.equal(inArchivero(t('doing'), now), false);
});

test('matchesTab y archiveTabCounts', () => {
  const list = [
    t('done', { completedAt: new Date(now - 3 * DAY).toISOString() }),
    t('cancelled'),
    t('doing', { archived: true }),
    t('done', { archived: true }),
  ];
  assert.deepEqual(archiveTabCounts(list), { all: 4, done: 2, cancelled: 1, archived: 2 });
  assert.equal(matchesTab(list[2], 'archived'), true);
  assert.equal(matchesTab(list[2], 'done'), false);
  assert.equal(matchesTab(list[0], 'all'), true);
});

test('matchesArchiveView: todas, no archivadas y archivadas', () => {
  const list = [
    { status: 'todo' }, { status: 'doing', archived: false }, { status: 'done', archived: true },
    { status: 'todo', archived: true }, { status: 'cancelled', archived: true },
  ];
  assert.equal(list.filter(a => matchesArchiveView(a, 'all')).length, 5);
  assert.deepEqual(list.filter(a => matchesArchiveView(a, 'active')).map(a => a.status), ['todo', 'doing']);
  assert.deepEqual(list.filter(a => matchesArchiveView(a, 'archived')).map(a => a.status), ['done', 'todo', 'cancelled']);
  assert.deepEqual(archiveViewCounts(list), { all: 5, active: 2, archived: 3 });
});
