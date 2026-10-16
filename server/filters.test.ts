import { test } from 'node:test';
import assert from 'node:assert/strict';
// Same convention as dates.test.ts: src/ has no Node types, so the test lives here.
import { isFilterActive, matchesFilter, summarizeMatches, describeMatches } from '../src/filters.ts';

const today = '2026-10-16';
const none = { statuses: new Set<'todo' | 'doing' | 'done' | 'cancelled'>(), overdueOnly: false, users: new Set<string>() };
const t = (status: string, endDate: string, username = 'Ana') => ({ status, endDate, username }) as any;

test('isFilterActive: cualquier condición activa cuenta', () => {
  assert.equal(isFilterActive(none), false);
  assert.equal(isFilterActive({ ...none, statuses: new Set(['todo'] as const) }), true);
  assert.equal(isFilterActive({ ...none, overdueOnly: true }), true);
  assert.equal(isFilterActive({ ...none, users: new Set(['ana']) }), true);
});

test('matchesFilter: sin filtro coincide todo', () => {
  assert.equal(matchesFilter(t('done', '2020-01-01'), none, today), true);
});

test('matchesFilter: estados son "cualquiera de"; retrasadas es una condición extra; usuarios restringe', () => {
  const doingOrTodo = { ...none, statuses: new Set(['todo', 'doing'] as const) };
  assert.equal(matchesFilter(t('doing', '2026-12-01'), doingOrTodo, today), true);
  assert.equal(matchesFilter(t('done', '2026-12-01'), doingOrTodo, today), false);
  const lateDoing = { ...doingOrTodo, overdueOnly: true };
  assert.equal(matchesFilter(t('doing', '2026-10-01'), lateDoing, today), true);
  assert.equal(matchesFilter(t('doing', '2026-12-01'), lateDoing, today), false);
  const onlyBeto = { ...none, users: new Set(['beto']) };
  assert.equal(matchesFilter(t('todo', '2026-12-01', 'Ana'), onlyBeto, today), false);
  assert.equal(matchesFilter(t('todo', '2026-12-01', 'BETO'), onlyBeto, today), true);
});

test('summarizeMatches cuenta solo las tareas que coinciden', () => {
  const tasks = [t('todo', '2026-10-01'), t('doing', '2026-10-01'), t('doing', '2026-12-01'), t('cancelled', '2026-10-01'), t('done', '2026-10-01')];
  const s = summarizeMatches(tasks, { ...none, overdueOnly: true }, today);
  assert.deepEqual(s, { matching: 2, overdue: 2, todo: 1, doing: 1, done: 0, cancelled: 0 });
  const c = summarizeMatches(tasks, { ...none, statuses: new Set(['cancelled'] as const) }, today);
  assert.equal(c.matching, 1);
  assert.equal(c.cancelled, 1);
});

test('describeMatches redacta según el filtro', () => {
  const tasks = [t('todo', '2026-10-01'), t('doing', '2026-10-01'), t('cancelled', '2026-12-01'), t('cancelled', '2026-12-02')];
  assert.equal(describeMatches(summarizeMatches(tasks, { ...none, overdueOnly: true }, today), { ...none, overdueOnly: true }), '2 retrasadas');
  assert.equal(describeMatches({ matching: 1, overdue: 1, todo: 0, doing: 0, done: 0, cancelled: 0 }, { ...none, overdueOnly: true }), '1 retrasada');
  const st = { ...none, statuses: new Set(['cancelled', 'todo'] as const) };
  assert.equal(describeMatches(summarizeMatches(tasks, st, today), st), '1 por realizar, 2 canceladas');
  const us = { ...none, users: new Set(['ana']) };
  assert.equal(describeMatches(summarizeMatches(tasks, us, today), us), '4 tareas');
  assert.equal(describeMatches({ matching: 1, overdue: 0, todo: 0, doing: 0, done: 0, cancelled: 0 }, us), '1 tarea');
});
