import { test } from 'node:test';
import assert from 'node:assert/strict';
// Same convention as dates.test.ts: src/ has no Node types, so the test lives here.
import { summarizeUser, sortUsers, donutArcs } from '../src/stats.ts';

const today = '2026-10-16';
const t = (status: string, endDate = '2026-12-01', extra: Record<string, unknown> = {}) => ({ status, endDate, archived: false, ...extra }) as any;

test('summarizeUser cuenta por estado, % completado y retrasadas sobre las abiertas', () => {
  const acts = [t('done'), t('done'), t('doing', '2026-10-01'), t('todo', '2026-10-02'), t('todo'), t('cancelled')];
  const s = summarizeUser(acts, today);
  assert.deepEqual(s, { todo: 2, doing: 1, done: 2, cancelled: 1, total: 6, rate: 33, open: 3, overdue: 2, overdueShare: 67 });
});

test('summarizeUser sin tareas: todo en cero y % 0', () => {
  assert.deepEqual(summarizeUser([], today), { todo: 0, doing: 0, done: 0, cancelled: 0, total: 0, rate: 0, open: 0, overdue: 0, overdueShare: 0 });
});

test('summarizeUser no cuenta como abierta/retrasada una tarea archivada', () => {
  const s = summarizeUser([t('todo', '2026-10-01', { archived: true }), t('doing', '2026-10-01')], today);
  assert.equal(s.open, 1);
  assert.equal(s.overdue, 1);
});

test('sortUsers: por completado, por retrasadas o por total; estable y con desempate', () => {
  const rows = [
    { name: 'A', rate: 50, overdue: 0, total: 4 },
    { name: 'B', rate: 80, overdue: 2, total: 5 },
    { name: 'C', rate: 80, overdue: 1, total: 10 },
    { name: 'D', rate: 10, overdue: 2, total: 20 },
  ];
  assert.deepEqual(sortUsers(rows, 'rate').map(r => r.name), ['C', 'B', 'A', 'D']);       // rate desc, luego total desc
  assert.deepEqual(sortUsers(rows, 'overdue').map(r => r.name), ['D', 'B', 'C', 'A']);    // retrasadas desc, luego total desc
  assert.deepEqual(sortUsers(rows, 'total').map(r => r.name), ['D', 'C', 'B', 'A']);
  assert.deepEqual(rows.map(r => r.name), ['A', 'B', 'C', 'D']);                          // no muta la entrada
});

test('donutArcs reparte fracciones que suman 1 en orden hecho, en curso, por hacer, cancelado', () => {
  const arcs = donutArcs({ todo: 1, doing: 1, done: 2, cancelled: 0 });
  assert.deepEqual(arcs.map(a => a.key), ['done', 'doing', 'todo']);                      // omite los de 0
  assert.deepEqual(arcs.map(a => a.fraction), [0.5, 0.25, 0.25]);
  assert.deepEqual(arcs.map(a => a.start), [0, 0.5, 0.75]);
});

test('donutArcs sin tareas devuelve lista vacía', () => {
  assert.deepEqual(donutArcs({ todo: 0, doing: 0, done: 0, cancelled: 0 }), []);
});
