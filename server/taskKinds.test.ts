import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedGroup, sharedProgress, describeRepeat, dayFor, usesWeekday, unreadComments, REPEAT_OPTIONS } from '../src/taskKinds.ts';

const a = (sharedId: string | undefined, status: string, progress?: number) => ({ sharedId, status, progress });

test('sharedGroup junta solo las copias de esa tarea', () => {
  const all = [a('s1', 'todo'), a('s2', 'todo'), a('s1', 'done'), a(undefined, 'todo')];
  assert.equal(sharedGroup(all, 's1').length, 2);
  assert.equal(sharedGroup(all, undefined).length, 0);
});

test('sharedProgress promedia el avance de cada persona', () => {
  assert.deepEqual(sharedProgress([a('s', 'doing', 40), a('s', 'doing', 60)]), { average: 50, people: 2 });
});

test('sharedProgress: hecha cuenta 100, por hacer cuenta 0', () => {
  assert.deepEqual(sharedProgress([a('s', 'done'), a('s', 'todo', 0), a('s', 'doing', 50)]), { average: 50, people: 3 });
});

test('sharedProgress: las canceladas no cuentan en el promedio', () => {
  assert.deepEqual(sharedProgress([a('s', 'done', 100), a('s', 'cancelled', 0)]), { average: 100, people: 2 });
  assert.deepEqual(sharedProgress([a('s', 'cancelled')]), { average: null, people: 1 });
});

test('sharedProgress redondea', () => {
  assert.equal(sharedProgress([a('s', 'doing', 33), a('s', 'doing', 34), a('s', 'todo', 0)]).average, 22);
});

test('opciones de repetición', () => {
  assert.deepEqual(REPEAT_OPTIONS.map(o => o.value), ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly']);
});

test('describeRepeat dice qué día se regenera', () => {
  assert.deepEqual(describeRepeat({ repeat: 'weekly', repeatDay: 1 }), { label: 'Cada semana, los lunes', short: 'Lunes' });
  assert.deepEqual(describeRepeat({ repeat: 'biweekly', repeatDay: 5 }), { label: 'Cada 2 semanas, los viernes', short: 'Viernes' });
  assert.deepEqual(describeRepeat({ repeat: 'monthly', repeatDay: 15 }), { label: 'Cada mes, el día 15', short: 'Día 15' });
  assert.deepEqual(describeRepeat({ repeat: 'quarterly', repeatDay: 1 }), { label: 'Cada trimestre, el día 1', short: 'Día 1' });
  assert.deepEqual(describeRepeat({ repeat: 'yearly', repeatDay: 3, repeatMonth: 3 }), { label: 'Cada año, el 3 de marzo', short: '3 mar' });
});

test('describeRepeat sin regla conocida cae en un texto genérico', () => {
  assert.deepEqual(describeRepeat({ repeat: 'monthly' }), { label: 'Cada mes', short: 'Repetitiva' });
  assert.deepEqual(describeRepeat({}), { label: 'Repetitiva', short: 'Repetitiva' });
});

test('dayFor mantiene el día válido al cambiar de frecuencia', () => {
  assert.equal(dayFor('weekly', 20), 1);   // los días de la semana solo llegan al viernes (5)
  assert.equal(dayFor('weekly', 3), 3);
  assert.equal(dayFor('monthly', 20), 20);
  assert.equal(dayFor('monthly', 0), 1);
  assert.equal(usesWeekday('biweekly'), true);
  assert.equal(usesWeekday('monthly'), false);
});

test('unreadComments: lo de otros posterior a tu última lectura; no lo tuyo; sin lectura, desde tu copia', () => {
  const c = (username: string, createdAt: string, sharedId = 's') => ({ sharedId, username, createdAt });
  const comments = [c('Beto', '2026-10-28T10:05:00Z'), c('Ana', '2026-10-28T10:06:00Z'), c('Beto', '2026-10-28T10:07:00Z'), c('Beto', '2026-10-28T10:08:00Z', 'otra')];
  assert.equal(unreadComments(comments, [], { sharedId: 's', myCopyCreatedAt: '2026-10-28T10:00:00Z' }, 'Ana'), 2);
  assert.equal(unreadComments(comments, [], { sharedId: 's', myCopyCreatedAt: '2026-10-28T10:06:30Z' }, 'ana'), 1); // el anterior a tu copia no cuenta
  const reads = [{ username: 'Ana', sharedId: 's', lastReadAt: '2026-10-28T10:07:00Z' }];
  assert.equal(unreadComments(comments, reads, { sharedId: 's', myCopyCreatedAt: '2026-10-28T10:00:00Z' }, 'Ana'), 0);
  assert.equal(unreadComments(comments, reads, { sharedId: 's' }, 'Beto'), 1); // el de Ana
});
