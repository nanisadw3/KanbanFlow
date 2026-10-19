import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLoginSummary } from '../src/summary.ts';
import type { Activity } from '../src/db.ts';

const today = '2026-10-19';
const prev = '2026-10-18T12:00:00.000Z';

const act = (id: string, o: Partial<Activity> = {}): Activity => ({
  id, title: 'T' + id, description: '', startDate: '2026-10-01', endDate: '2026-10-30', status: 'todo',
  username: 'Ana', createdAt: '2026-10-17T00:00:00.000Z', assignedBy: 'Roberto', priority: 'media', ...o,
});

test('nuevas: asignadas por otra persona después del login anterior', () => {
  const list = [
    act('viejaa', { createdAt: '2026-10-17T00:00:00.000Z' }),
    act('nueva', { createdAt: '2026-10-19T08:00:00.000Z' }),
  ];
  assert.deepEqual(buildLoginSummary(list, 'Ana', prev, today).fresh.map(a => a.id), ['nueva']);
});

test('no cuenta como nueva la que se creó el propio usuario ni las sin quien asignó', () => {
  const list = [
    act('propia', { createdAt: '2026-10-19T08:00:00.000Z', assignedBy: 'ana' }),
    act('sinAsignador', { createdAt: '2026-10-19T08:00:00.000Z', assignedBy: undefined }),
  ];
  assert.deepEqual(buildLoginSummary(list, 'Ana', prev, today).fresh, []);
});

test('ignora tareas de otros usuarios, terminadas, canceladas y archivadas', () => {
  const recent = '2026-10-19T08:00:00.000Z';
  const list = [
    act('otro', { username: 'Beto', createdAt: recent }),
    act('hecha', { status: 'done', createdAt: recent }),
    act('cancelada', { status: 'cancelled', createdAt: recent }),
    act('archivada', { archived: true, createdAt: recent }),
    act('ok', { createdAt: recent }),
  ];
  assert.deepEqual(buildLoginSummary(list, 'Ana', prev, today).fresh.map(a => a.id), ['ok']);
});

test('el usuario se compara sin distinguir mayúsculas', () => {
  const list = [act('x', { username: 'ANA', createdAt: '2026-10-19T08:00:00.000Z' })];
  assert.equal(buildLoginSummary(list, 'ana', prev, today).fresh.length, 1);
});

test('retrasadas: abiertas con fecha vencida, la más atrasada primero', () => {
  const list = [
    act('poco', { endDate: '2026-10-18' }),
    act('mucho', { endDate: '2026-10-10', status: 'doing' }),
    act('hoy', { endDate: '2026-10-19' }),
    act('hechaTarde', { endDate: '2026-10-10', status: 'done' }),
    act('archivadaTarde', { endDate: '2026-10-10', archived: true }),
  ];
  assert.deepEqual(buildLoginSummary(list, 'Ana', prev, today).overdue.map(a => a.id), ['mucho', 'poco']);
});

test('una tarea nueva que ya nace retrasada sale solo en retrasadas', () => {
  const list = [act('n', { createdAt: '2026-10-19T08:00:00.000Z', endDate: '2026-10-15' })];
  const s = buildLoginSummary(list, 'Ana', prev, today);
  assert.deepEqual(s.overdue.map(a => a.id), ['n']);
  assert.deepEqual(s.fresh, []);
});

test('sin login anterior conocido no se anuncian nuevas, pero sí retrasadas', () => {
  const list = [
    act('n', { createdAt: '2026-10-19T08:00:00.000Z' }),
    act('r', { endDate: '2026-10-10' }),
  ];
  for (const none of [null, undefined, 'no-es-fecha']) {
    const s = buildLoginSummary(list, 'Ana', none, today);
    assert.deepEqual(s.fresh, []);
    assert.deepEqual(s.overdue.map(a => a.id), ['r']);
  }
});
