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

// ───────── Periodo, alcance, cumplimiento, tendencia y antigüedad ─────────
import { periodStart, inPeriod, closeStats, weeklyTrend, agingBuckets, matchesDrill, inScope } from '../src/stats.ts';

const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

test('periodStart: ventana en días o null para "todo"', () => {
  const now = new Date(2026, 9, 16, 12);
  assert.equal(periodStart('all', now), null);
  assert.equal(periodStart('7d', now), now.getTime() - 7 * 86400000);
  assert.equal(periodStart('90d', now), now.getTime() - 90 * 86400000);
});

test('inPeriod: las abiertas siempre cuentan; hechas por fecha de cierre; canceladas por creación', () => {
  const start = new Date(2026, 9, 1).getTime();
  assert.equal(inPeriod(t('todo', '2026-01-01', { createdAt: iso(2026, 1, 1) }), start), true);
  assert.equal(inPeriod(t('doing', '2026-01-01', { createdAt: iso(2026, 1, 1) }), start), true);
  assert.equal(inPeriod(t('done', '2026-10-05', { completedAt: iso(2026, 10, 5), createdAt: iso(2026, 1, 1) }), start), true);
  assert.equal(inPeriod(t('done', '2026-08-05', { completedAt: iso(2026, 8, 5), createdAt: iso(2026, 8, 1) }), start), false);
  assert.equal(inPeriod(t('done', '2026-10-05', { createdAt: iso(2026, 10, 2) }), start), true);   // sin completedAt: usa createdAt
  assert.equal(inPeriod(t('cancelled', '2026-08-05', { createdAt: iso(2026, 8, 1) }), start), false);
  assert.equal(inPeriod(t('done', '2020-01-01', { completedAt: iso(2020, 1, 1) }), null), true);   // todo el historial
});

test('inScope: personales, equipos o todo', () => {
  assert.equal(inScope(t('todo', '2026-10-01', { teamId: null }), 'personal'), true);
  assert.equal(inScope(t('todo', '2026-10-01', { teamId: 'team_1' }), 'personal'), false);
  assert.equal(inScope(t('todo', '2026-10-01', { teamId: 'team_1' }), 'teams'), true);
  assert.equal(inScope(t('todo', '2026-10-01', { teamId: undefined }), 'teams'), false);
  assert.equal(inScope(t('todo', '2026-10-01', { teamId: 'team_1' }), 'all'), true);
});

test('closeStats: a tiempo y días medios de cierre solo con tareas que tienen completedAt', () => {
  const tasks = [
    t('done', '2026-10-10', { createdAt: iso(2026, 10, 1), completedAt: iso(2026, 10, 9) }),   // a tiempo, 8 días
    t('done', '2026-10-10', { createdAt: iso(2026, 10, 1), completedAt: iso(2026, 10, 11) }),  // tarde, 10 días
    t('done', '2026-10-10', { createdAt: iso(2026, 10, 1), completedAt: iso(2026, 10, 10, 23) }), // el mismo día de fin: a tiempo, ~9 días
    t('done', '2026-10-10', {}),                                                              // sin fecha: no cuenta
    t('doing', '2026-10-10', {}),
  ];
  const c = closeStats(tasks);
  assert.equal(c.doneTotal, 4);
  assert.equal(c.withDate, 3);
  assert.equal(c.onTime, 2);
  assert.equal(c.onTimeRate, 67);
  assert.equal(Math.round((c.avgCloseDays ?? 0) * 10) / 10, 9.2); // (8 + 10 + 9,46) / 3
});

test('closeStats sin datos: tasa y promedio nulos', () => {
  assert.deepEqual(closeStats([]), { doneTotal: 0, withDate: 0, onTime: 0, onTimeRate: null, avgCloseDays: null });
});

test('weeklyTrend: 8 semanas que empiezan en lunes, con creadas y completadas', () => {
  const now = new Date(2026, 9, 16, 12);   // viernes 16 oct 2026 -> la semana actual empieza el lunes 12 oct
  const tasks = [
    t('done', '2026-10-20', { createdAt: iso(2026, 10, 13), completedAt: iso(2026, 10, 15) }), // semana actual: creada y completada
    t('todo', '2026-10-30', { createdAt: iso(2026, 10, 5) }),                                    // semana del 5 oct: creada
    t('done', '2026-09-01', { createdAt: iso(2026, 8, 10), completedAt: iso(2026, 8, 20) }),     // fuera de las 8 semanas (la primera empieza el 24 ago)
  ];
  const w = weeklyTrend(tasks, now, 8);
  assert.equal(w.length, 8);
  assert.equal(w[7].start, '2026-10-12');
  assert.equal(w[0].start, '2026-08-24');
  assert.deepEqual([w[7].created, w[7].completed], [1, 1]);
  assert.deepEqual([w[6].created, w[6].completed], [1, 0]);
  assert.equal(w.reduce((n, x) => n + x.created + x.completed, 0), 3);
});

test('agingBuckets reparte las retrasadas vivas por días de retraso', () => {
  const today = '2026-10-16';
  const tasks = [
    t('todo', '2026-10-15'),                                  // 1 día
    t('doing', '2026-10-13'),                                 // 3 días
    t('todo', '2026-10-12'),                                  // 4 días
    t('todo', '2026-10-09'),                                  // 7 días
    t('doing', '2026-10-08'),                                 // 8 días
    t('todo', '2026-09-01'),                                  // 45 días
    t('todo', '2026-10-01', { archived: true }),              // archivada: no cuenta
    t('done', '2026-10-01'),                                  // hecha: no cuenta
    t('todo', '2026-10-16'),                                  // vence hoy: aún no
  ];
  assert.deepEqual(agingBuckets(tasks, today), { d1_3: 2, d4_7: 2, d8plus: 2, total: 6 });
});

test('matchesDrill filtra por estado, retrasadas o tramo de antigüedad', () => {
  const today = '2026-10-16';
  assert.equal(matchesDrill(t('done', '2026-10-01'), 'done', today), true);
  assert.equal(matchesDrill(t('done', '2026-10-01'), 'doing', today), false);
  assert.equal(matchesDrill(t('doing', '2026-10-01'), 'overdue', today), true);
  assert.equal(matchesDrill(t('done', '2026-10-01'), 'overdue', today), false);
  assert.equal(matchesDrill(t('todo', '2026-10-14'), 'aging:d1_3', today), true);
  assert.equal(matchesDrill(t('todo', '2026-10-14'), 'aging:d4_7', today), false);
  assert.equal(matchesDrill(t('todo', '2026-10-01'), 'aging:d8plus', today), true);
});
