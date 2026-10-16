import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoCompleteAtFull } from './autocomplete.ts';

const now = '2026-10-16T12:00:00.000Z';

test('doing que sube a 100 pasa a done con completedAt', () => {
  const r = autoCompleteAtFull({ progress: 60 }, { status: 'doing', progress: 100, completedAt: null }, now);
  assert.deepEqual(r, { status: 'done', progress: 100, completedAt: now });
});

test('todo que llega a 100 también pasa a done', () => {
  assert.equal(autoCompleteAtFull({ progress: 0 }, { status: 'todo', progress: 100, completedAt: null }, now).status, 'done');
});

test('si ya estaba al 100 no rebota (p. ej. arrastrada a En Realización)', () => {
  const r = autoCompleteAtFull({ progress: 100 }, { status: 'doing', progress: 100, completedAt: null }, now);
  assert.equal(r.status, 'doing');
  assert.equal(r.completedAt, null);
});

test('no toca done, cancelled ni avances menores a 100', () => {
  assert.equal(autoCompleteAtFull({ progress: 10 }, { status: 'cancelled', progress: 100, completedAt: null }, now).status, 'cancelled');
  assert.equal(autoCompleteAtFull({ progress: 10 }, { status: 'done', progress: 100, completedAt: 'x' }, now).completedAt, 'x');
  assert.equal(autoCompleteAtFull({ progress: 10 }, { status: 'doing', progress: 99, completedAt: null }, now).status, 'doing');
});

test('avance anterior nulo cuenta como 0', () => {
  assert.equal(autoCompleteAtFull({ progress: null }, { status: 'doing', progress: 100, completedAt: null }, now).status, 'done');
});
