import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { addDays, isRepeat, normalizeRule, nextOccurrence, dueOccurrence, createSeries, runRecurrences, stopSeries, dropSeriesWhere, ensureRecurrenceTable, type Rule } from './recurrence.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (username TEXT PRIMARY KEY, fullName TEXT, role TEXT, lastLogin TEXT, email TEXT);
    CREATE TABLE activities (id TEXT PRIMARY KEY, title TEXT, description TEXT, startDate TEXT, endDate TEXT,
      status TEXT, username TEXT, createdAt TEXT, assignedBy TEXT, priority TEXT, progress INTEGER,
      teamId TEXT, completedAt TEXT, archived INTEGER DEFAULT 0, overdueNotifiedAt TEXT,
      kind TEXT NOT NULL DEFAULT 'single', sharedId TEXT, seriesId TEXT);
    INSERT INTO users VALUES ('Ana','Ana P','user','x','ana@x.com');
  `);
  await ensureRecurrenceTable(db);
  return db;
}
const rule = (repeat: Rule['repeat'], day: number, month: number | null = null): Rule => ({ repeat, day, month });
const series = (db: Database, over: Partial<Parameters<typeof createSeries>[1]> = {}) =>
  createSeries(db, { rule: rule('weekly', 1), title: 'Reporte', description: 'd', priority: 'alta', username: 'Ana', assignedBy: null, teamId: null, startDate: '2026-10-28', ...over });

// 2026-10-26 is a Monday, 2026-10-28 a Wednesday.

test('addDays e isRepeat', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(isRepeat('monthly'), true);
  assert.equal(isRepeat('daily'), false);
  assert.equal(isRepeat(undefined), false);
});

test('normalizeRule corrige valores fuera de rango', () => {
  assert.deepEqual(normalizeRule('weekly', 3, null), rule('weekly', 3));
  assert.deepEqual(normalizeRule('weekly', 6, null), rule('weekly', 1));   // solo lunes a viernes
  assert.deepEqual(normalizeRule('monthly', 31, 5), rule('monthly', 31)); // el mes solo importa en anual
  assert.deepEqual(normalizeRule('monthly', 0, null), rule('monthly', 1));
  assert.deepEqual(normalizeRule('yearly', '15', '3'), rule('yearly', 15, 3));
  assert.deepEqual(normalizeRule('yearly', 15, 13), rule('yearly', 15, 1));
});

test('semanal: el siguiente día elegido, estrictamente después de la última', () => {
  assert.equal(nextOccurrence(rule('weekly', 1), '2026-10-28'), '2026-11-02'); // miércoles -> lunes siguiente
  assert.equal(nextOccurrence(rule('weekly', 1), '2026-10-26'), '2026-11-02'); // lunes -> lunes siguiente, no el mismo día
  assert.equal(nextOccurrence(rule('weekly', 5), '2026-10-28'), '2026-10-30'); // viernes de esta semana
});

test('cada 2 semanas: deja al menos 8 días y cae en el día elegido', () => {
  assert.equal(nextOccurrence(rule('biweekly', 1), '2026-10-26'), '2026-11-09');
  assert.equal(nextOccurrence(rule('biweekly', 1), '2026-10-28'), '2026-11-09');
});

test('mensual: este mes si el día aún no llega, si no el siguiente', () => {
  assert.equal(nextOccurrence(rule('monthly', 15), '2026-10-10'), '2026-10-15');
  assert.equal(nextOccurrence(rule('monthly', 15), '2026-10-15'), '2026-11-15');
  assert.equal(nextOccurrence(rule('monthly', 15), '2026-10-28'), '2026-11-15');
});

test('mensual: un día 31 usa el último día de los meses cortos y no arrastra el error', () => {
  assert.equal(nextOccurrence(rule('monthly', 31), '2026-01-31'), '2026-02-28');
  assert.equal(nextOccurrence(rule('monthly', 31), '2026-02-28'), '2026-03-31');
  assert.equal(nextOccurrence(rule('monthly', 31), '2028-01-31'), '2028-02-29');
});

test('trimestral y semestral: el día elegido, 3 o 6 meses después', () => {
  assert.equal(nextOccurrence(rule('quarterly', 15), '2026-10-28'), '2027-01-15');
  assert.equal(nextOccurrence(rule('semiannual', 1), '2026-10-28'), '2027-04-01');
  assert.equal(nextOccurrence(rule('quarterly', 31), '2026-11-30'), '2027-02-28');
});

test('anual: día y mes elegidos, este año si aún no llegan', () => {
  assert.equal(nextOccurrence(rule('yearly', 15, 12), '2026-10-28'), '2026-12-15');
  assert.equal(nextOccurrence(rule('yearly', 15, 3), '2026-10-28'), '2027-03-15');
  assert.equal(nextOccurrence(rule('yearly', 29, 2), '2027-03-01'), '2028-02-29');
});

test('dueOccurrence: nada antes de tiempo, el día exacto ya cuenta', () => {
  assert.equal(dueOccurrence(rule('weekly', 1), '2026-10-28', '2026-11-01'), null);
  assert.equal(dueOccurrence(rule('weekly', 1), '2026-10-28', '2026-11-02'), '2026-11-02');
});

test('dueOccurrence: tras varios periodos sin servidor solo devuelve el más reciente', () => {
  assert.equal(dueOccurrence(rule('weekly', 1), '2026-10-28', '2026-11-25'), '2026-11-23');
});

test('runRecurrences crea la tarea sin fecha de fin y no la duplica', async () => {
  const db = await makeDb();
  const id = await series(db);
  assert.equal(await runRecurrences(db, '2026-11-01'), 0);
  assert.equal(await runRecurrences(db, '2026-11-02'), 1);
  assert.equal(await runRecurrences(db, '2026-11-02'), 0);
  const row = await db.get("SELECT * FROM activities WHERE kind = 'recurring'");
  assert.equal(row.startDate, '2026-11-02');
  assert.equal(row.endDate, '');
  assert.equal(row.status, 'todo');
  assert.equal(row.progress, 0);
  assert.equal(row.seriesId, id);
  assert.equal(row.username, 'Ana');
  assert.equal(row.priority, 'alta');
});

test('runRecurrences avanza semana a semana', async () => {
  const db = await makeDb();
  await series(db);
  await runRecurrences(db, '2026-11-02');
  await runRecurrences(db, '2026-11-09');
  assert.equal((await db.get("SELECT COUNT(*) n FROM activities WHERE kind = 'recurring'")).n, 2);
});

test('una serie de un usuario que ya no existe se detiene sola', async () => {
  const db = await makeDb();
  await series(db, { username: 'Fantasma' });
  assert.equal(await runRecurrences(db, '2026-12-30'), 0);
  assert.equal((await db.get('SELECT COUNT(*) n FROM recurrences')).n, 0);
});

test('stopSeries deja las tareas existentes como normales y no genera más', async () => {
  const db = await makeDb();
  const id = await series(db);
  await runRecurrences(db, '2026-11-02');
  await stopSeries(db, id);
  const row = await db.get('SELECT kind, seriesId FROM activities');
  assert.equal(row.kind, 'single');
  assert.equal(row.seriesId, null);
  assert.equal(await runRecurrences(db, '2027-03-01'), 0);
});

test('dropSeriesWhere detiene las series de un usuario o equipo', async () => {
  const db = await makeDb();
  await series(db);
  await series(db, { teamId: 'team_1' });
  await dropSeriesWhere(db, 'teamId', 'team_1');
  assert.equal((await db.get('SELECT COUNT(*) n FROM recurrences')).n, 1);
  await dropSeriesWhere(db, 'username', 'ana');
  assert.equal((await db.get('SELECT COUNT(*) n FROM recurrences')).n, 0);
});
