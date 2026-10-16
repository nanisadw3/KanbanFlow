import { test } from 'node:test';
import assert from 'node:assert/strict';
// Lives next to the other tests so it runs with `npm run test:server` (src/ is type-checked
// without Node types, so a node:test file can't live there).
import { todayString, isOverdue, daysOverdue, overdueLabel, countOpenAndOverdue, overdueRate, formatShortDate } from '../src/dates.ts';

test('todayString formatea YYYY-MM-DD en hora local', () => {
  assert.equal(todayString(new Date(2026, 9, 5, 23, 59)), '2026-10-05');
});

test('isOverdue: fecha pasada y estado abierto', () => {
  const today = '2026-10-16';
  assert.equal(isOverdue({ endDate: '2026-10-15', status: 'todo' }, today), true);
  assert.equal(isOverdue({ endDate: '2026-10-15', status: 'doing' }, today), true);
  assert.equal(isOverdue({ endDate: '2026-10-16', status: 'doing' }, today), false); // vence hoy: aún no
  assert.equal(isOverdue({ endDate: '2026-10-17', status: 'todo' }, today), false);
  assert.equal(isOverdue({ endDate: '2026-10-01', status: 'done' }, today), false);
  assert.equal(isOverdue({ endDate: '2026-10-01', status: 'cancelled' }, today), false);
  assert.equal(isOverdue({ endDate: '', status: 'todo' }, today), false);
});

test('daysOverdue cuenta días completos, también entre meses', () => {
  assert.equal(daysOverdue('2026-10-15', '2026-10-16'), 1);
  assert.equal(daysOverdue('2026-09-28', '2026-10-02'), 4);
  assert.equal(daysOverdue('2026-10-16', '2026-10-16'), 0);
});

test('overdueLabel dice ayer / hace N días / nada si no está retrasada', () => {
  assert.equal(overdueLabel('2026-10-15', '2026-10-16'), 'Venció ayer');
  assert.equal(overdueLabel('2026-10-11', '2026-10-16'), 'Venció hace 5 días');
  assert.equal(overdueLabel('2026-10-16', '2026-10-16'), '');
});

test('countOpenAndOverdue y overdueRate (base: tareas abiertas)', () => {
  const acts = [
    { endDate: '2026-10-01', status: 'todo' },
    { endDate: '2026-10-20', status: 'doing' },
    { endDate: '2026-10-01', status: 'doing' },
    { endDate: '2026-10-01', status: 'done' },
    { endDate: '2026-10-01', status: 'cancelled' },
  ];
  const c = countOpenAndOverdue(acts, '2026-10-16');
  assert.deepEqual(c, { open: 3, overdue: 2 });
  assert.equal(overdueRate(c), 67);
  assert.equal(overdueRate({ open: 0, overdue: 0 }), 0);
});

test('formatShortDate: día y mes cortos; año solo si no es el actual', () => {
  assert.equal(formatShortDate('2026-10-12', 2026), '12 oct');
  assert.equal(formatShortDate('2026-01-05', 2026), '5 ene');
  assert.equal(formatShortDate('2025-12-01', 2026), '1 dic 2025');
  assert.equal(formatShortDate('', 2026), '');
  assert.equal(formatShortDate('no-es-fecha', 2026), 'no-es-fecha');
});
