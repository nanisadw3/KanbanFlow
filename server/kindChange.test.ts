import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { changeKind, type KindChangeInput } from './kindChange.ts';
import { createSharedTask, ensureCommentsTable, ensureCommentReadsTable, addComment, pruneComments } from './shared.ts';
import { ensureRecurrenceTable, runRecurrences, removeUserFromSeries, dropSeriesWhere } from './recurrence.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (username TEXT PRIMARY KEY, fullName TEXT, role TEXT, lastLogin TEXT, email TEXT);
    CREATE TABLE activities (id TEXT PRIMARY KEY, title TEXT, description TEXT, startDate TEXT, endDate TEXT,
      status TEXT, username TEXT, createdAt TEXT, assignedBy TEXT, priority TEXT, progress INTEGER,
      teamId TEXT, completedAt TEXT, archived INTEGER DEFAULT 0, overdueNotifiedAt TEXT,
      kind TEXT NOT NULL DEFAULT 'single', sharedId TEXT, seriesId TEXT);
    CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT, memberUsernames TEXT, createdAt TEXT);
    INSERT INTO users VALUES ('Ana','Ana P','user','x','ana@x.com'), ('Beto','Beto R','user','x','beto@x.com'),
      ('Eva','Eva Z','user','x','eva@x.com'), ('Luis','Luis A','admin','x','luis@x.com');
    INSERT INTO activities (id,title,description,startDate,endDate,status,username,createdAt,priority,progress,kind)
      VALUES ('a1','Informe','d','2026-10-01','2026-10-09','doing','Ana','2026-10-01','alta',40,'single');
  `);
  await ensureCommentsTable(db);
  await ensureCommentReadsTable(db);
  await ensureRecurrenceTable(db);
  return db;
}
const today = '2026-10-28';
// The four types as the two switches they are made of.
const TYPES = {
  single: { shared: false, repeating: false },
  shared: { shared: true, repeating: false },
  recurring: { shared: false, repeating: true },
  both: { shared: true, repeating: true },
};
const ch = (db: Database, i: Omit<KindChangeInput, 'shared' | 'repeating'> & { to: keyof typeof TYPES }, now = today) => {
  const { to, ...rest } = i;
  return changeKind(db, { ...rest, ...TYPES[to] }, now);
};
const sharedBase = { title: 'T', description: '', startDate: '2026-10-01', endDate: '2026-10-09', priority: 'media' as const, assignedBy: 'Ana', teamId: null };

test('individual → compartida: conserva su avance y suma copias en todo/0%', async () => {
  const db = await makeDb();
  const r = await ch(db, { id: 'a1', to: 'shared', by: 'Ana', usernames: ['Beto', 'eva', 'nadie'] }, today);
  assert.ok(r.ok);
  const rows = await db.all('SELECT username, status, progress, kind, assignedBy FROM activities ORDER BY username');
  assert.deepEqual(rows.map(x => x.username), ['Ana', 'Beto', 'Eva']);
  assert.deepEqual({ ...rows[0] }, { username: 'Ana', status: 'doing', progress: 40, kind: 'shared', assignedBy: null });
  assert.deepEqual({ ...rows[1] }, { username: 'Beto', status: 'todo', progress: 0, kind: 'shared', assignedBy: 'Ana' });
  assert.equal((await db.get('SELECT COUNT(DISTINCT sharedId) n FROM activities')).n, 1);
  if (r.ok) assert.deepEqual(r.added, ['Beto', 'Eva']);
});

test('individual → compartida: sin fechas válidas se rechaza y no escribe nada', async () => {
  const db = await makeDb();
  const r = await ch(db, { id: 'a1', to: 'shared', by: 'Ana', usernames: ['Beto'], fields: { endDate: '' } }, today);
  assert.deepEqual(r, { ok: false, error: 'invalid_dates' });
  assert.equal((await db.get("SELECT kind FROM activities WHERE id = 'a1'")).kind, 'single');
});

test('individual → repetitiva: crea la serie y la tarea queda sin fecha de fin', async () => {
  const db = await makeDb();
  const r = await ch(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'weekly', repeatDay: 3 }, today);
  assert.ok(r.ok);
  const a = await db.get("SELECT kind, seriesId, endDate, status FROM activities WHERE id = 'a1'");
  assert.equal(a.kind, 'recurring');
  assert.equal(a.endDate, '');
  assert.equal(a.status, 'doing');
  const s = await db.get('SELECT repeat, day, lastDate, username FROM recurrences WHERE id = ?', [a.seriesId]);
  assert.deepEqual({ ...s }, { repeat: 'weekly', day: 3, lastDate: today, username: 'Ana' });
});

test('repetitiva sin regla válida se rechaza', async () => {
  const db = await makeDb();
  assert.deepEqual(await ch(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'cada rato' }, today), { ok: false, error: 'invalid_repeat' });
});

test('compartida → individual: quita las copias ajenas y sus comentarios; conserva la de quien la cambia', async () => {
  const db = await makeDb();
  const { sharedId, ids } = await createSharedTask(db, { ...sharedBase, usernames: ['Ana', 'Beto'] });
  await addComment(db, { sharedId, username: 'Beto', text: 'hola' });
  const r = await ch(db, { id: ids[0], to: 'single', by: 'Ana' }, today);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.removed, ['Beto']);
  assert.equal((await db.get("SELECT COUNT(*) n FROM activities WHERE title = 'T'")).n, 1);
  assert.deepEqual({ ...(await db.get('SELECT kind, sharedId FROM activities WHERE id = ?', [ids[0]])) }, { kind: 'single', sharedId: null });
  await pruneComments(db);
  assert.equal((await db.get('SELECT COUNT(*) n FROM comments')).n, 0);
});

test('compartida: solo participantes o admin pueden cambiarla', async () => {
  const db = await makeDb();
  const { ids } = await createSharedTask(db, { ...sharedBase, usernames: ['Ana', 'Beto'] });
  assert.deepEqual(await ch(db, { id: ids[0], to: 'single', by: 'Eva' }, today), { ok: false, error: 'forbidden' });
  assert.deepEqual(await ch(db, { id: ids[0], to: 'single', by: 'Fantasma' }, today), { ok: false, error: 'forbidden' });
  assert.ok((await ch(db, { id: ids[0], to: 'single', by: 'Luis' }, today)).ok);
});

test('repetitiva → individual: detiene la serie y la tarea queda normal', async () => {
  const db = await makeDb();
  await ch(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'monthly', repeatDay: 5 }, today);
  const r = await ch(db, { id: 'a1', to: 'single', by: 'Ana' }, today);
  assert.ok(r.ok);
  assert.equal((await db.get('SELECT COUNT(*) n FROM recurrences')).n, 0);
  assert.deepEqual({ ...(await db.get("SELECT kind, seriesId FROM activities WHERE id = 'a1'")) }, { kind: 'single', seriesId: null });
});

test('repetitiva → compartida y compartida → repetitiva', async () => {
  const db = await makeDb();
  await ch(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'weekly', repeatDay: 1 }, today);
  const r = await ch(db, { id: 'a1', to: 'shared', by: 'Ana', usernames: ['Beto'], fields: { startDate: '2026-10-01', endDate: '2026-10-20' } }, today);
  assert.ok(r.ok);
  assert.equal((await db.get('SELECT COUNT(*) n FROM recurrences')).n, 0);
  assert.equal((await db.get("SELECT COUNT(*) n FROM activities WHERE kind = 'shared'")).n, 2);
  const back = await ch(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'weekly', repeatDay: 2 }, today);
  assert.ok(back.ok);
  assert.equal((await db.get('SELECT COUNT(*) n FROM activities')).n, 1); // la copia de Beto se fue
});

test('mismo tipo, tarea inexistente y tipo inválido', async () => {
  const db = await makeDb();
  assert.deepEqual(await ch(db, { id: 'a1', to: 'single', by: 'Ana' }, today), { ok: false, error: 'same_kind' });
  assert.deepEqual(await ch(db, { id: 'zz', to: 'shared', by: 'Ana' }, today), { ok: false, error: 'not_found' });
});

test('en una tarea de equipo solo se suman miembros del equipo', async () => {
  const db = await makeDb();
  await db.run('INSERT INTO teams VALUES (\'t1\',\'Eq\',\'["Ana","Beto"]\',\'x\')');
  await db.run("UPDATE activities SET teamId = 't1' WHERE id = 'a1'");
  const r = await ch(db, { id: 'a1', to: 'shared', by: 'Ana', usernames: ['Beto', 'Eva'] }, today);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.added, ['Beto']);
});

// ── Shared + repeating ──────────────────────────────────────────────────────────────────────

test('individual → compartida y repetitiva: la serie guarda a los participantes y todas las copias quedan en la serie', async () => {
  const db = await makeDb();
  const r = await ch(db, { id: 'a1', to: 'both', by: 'Ana', usernames: ['Beto'], repeat: 'weekly', repeatDay: 2 }, today);
  assert.ok(r.ok);
  const rows = await db.all('SELECT username, kind, seriesId, endDate, status, progress FROM activities ORDER BY username');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(x => x.kind === 'shared' && x.seriesId && x.endDate === ''));
  assert.equal(rows[0].seriesId, rows[1].seriesId);
  assert.deepEqual({ status: rows[0].status, progress: rows[0].progress }, { status: 'doing', progress: 40 }); // Ana conserva su avance
  const s = await db.get('SELECT participants, username, assignedBy FROM recurrences');
  assert.deepEqual(JSON.parse(s.participants), ['Ana', 'Beto']);
  assert.equal(s.assignedBy, 'Ana');
});

test('compartida → compartida y repetitiva usa a quienes ya están; y al revés la serie se detiene pero la tarea sigue compartida', async () => {
  const db = await makeDb();
  const { ids } = await createSharedTask(db, { ...sharedBase, usernames: ['Ana', 'Beto'] });
  const up = await ch(db, { id: ids[0], to: 'both', by: 'Ana', repeat: 'monthly', repeatDay: 5 }, today);
  assert.ok(up.ok);
  assert.deepEqual(JSON.parse((await db.get('SELECT participants p FROM recurrences')).p), ['Ana', 'Beto']);
  assert.equal((await db.get("SELECT COUNT(*) n FROM activities WHERE seriesId IS NOT NULL")).n, 2);
  const down = await ch(db, { id: ids[0], to: 'shared', by: 'Ana', fields: { startDate: '2026-10-01', endDate: '2026-10-30' } }, today);
  assert.ok(down.ok);
  assert.equal((await db.get('SELECT COUNT(*) n FROM recurrences')).n, 0);
  const rows = await db.all('SELECT kind, seriesId FROM activities WHERE title = ?', ['T']);
  assert.deepEqual(rows.map(x => ({ ...x })), [{ kind: 'shared', seriesId: null }, { kind: 'shared', seriesId: null }]);
});

test('compartida y repetitiva → repetitiva: quita a los demás y la serie queda para quien se queda', async () => {
  const db = await makeDb();
  await ch(db, { id: 'a1', to: 'both', by: 'Ana', usernames: ['Beto'], repeat: 'weekly', repeatDay: 1 }, today);
  const mine = (await db.get("SELECT id FROM activities WHERE username = 'Ana'")).id;
  const r = await ch(db, { id: mine, to: 'recurring', by: 'Ana' }, today);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.removed, ['Beto']);
  const s = await db.get('SELECT participants, username FROM recurrences');
  assert.deepEqual({ ...s }, { participants: null, username: 'Ana' });
  assert.deepEqual({ ...(await db.get('SELECT kind, sharedId FROM activities WHERE id = ?', [mine])) }, { kind: 'recurring', sharedId: null });
});

test('repetitiva → compartida y repetitiva: la misma serie pasa a ser compartida', async () => {
  const db = await makeDb();
  await ch(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'weekly', repeatDay: 1 }, today);
  const before = (await db.get('SELECT id FROM recurrences')).id;
  const r = await ch(db, { id: 'a1', to: 'both', by: 'Ana', usernames: ['Beto'] }, today);
  assert.ok(r.ok);
  assert.equal((await db.get('SELECT COUNT(*) n FROM recurrences')).n, 1);
  assert.equal((await db.get('SELECT id FROM recurrences')).id, before);
  assert.deepEqual(JSON.parse((await db.get('SELECT participants p FROM recurrences')).p), ['Ana', 'Beto']);
  assert.equal((await db.get("SELECT COUNT(*) n FROM activities WHERE seriesId = ?", [before])).n, 2);
});

test('cada ciclo crea una tarea compartida nueva (0%, otro hilo de comentarios) para los participantes', async () => {
  const db = await makeDb();
  await ch(db, { id: 'a1', to: 'both', by: 'Ana', usernames: ['Beto'], repeat: 'weekly', repeatDay: 1 }, today); // 2026-10-28 es miércoles
  await db.run("UPDATE activities SET status = 'done', progress = 100");
  const made = await runRecurrences(db, '2026-11-02'); // el lunes siguiente
  assert.equal(made, 1);
  const fresh = await db.all("SELECT username, status, progress, startDate, endDate, kind, sharedId, seriesId, assignedBy FROM activities WHERE startDate = '2026-11-02' ORDER BY username");
  assert.deepEqual(fresh.map(x => x.username), ['Ana', 'Beto']);
  assert.ok(fresh.every(x => x.status === 'todo' && x.progress === 0 && x.endDate === '' && x.kind === 'shared'));
  assert.equal(fresh[0].sharedId, fresh[1].sharedId);
  assert.notEqual(fresh[0].sharedId, (await db.get("SELECT sharedId FROM activities WHERE startDate = '2026-10-01'")).sharedId);
  assert.equal(fresh[0].seriesId, fresh[1].seriesId);
  assert.deepEqual([fresh[0].assignedBy, fresh[1].assignedBy], [null, 'Ana']);
  assert.equal(await runRecurrences(db, '2026-11-02'), 0); // no se repite el mismo día
});

test('si cambian los participantes de una ocurrencia, los siguientes ciclos ya los incluyen', async () => {
  const db = await makeDb();
  await ch(db, { id: 'a1', to: 'both', by: 'Ana', usernames: ['Beto'], repeat: 'weekly', repeatDay: 1 }, today);
  const sharedId = (await db.get("SELECT sharedId FROM activities WHERE username = 'Ana'")).sharedId;
  const { setParticipants } = await import('./shared.ts');
  const r = await setParticipants(db, { sharedId, usernames: ['Ana', 'Eva'], by: 'Ana' });
  assert.ok(r.ok);
  // la copia nueva de Eva también es parte de la serie
  assert.equal((await db.get("SELECT seriesId s FROM activities WHERE username = 'Eva'")).s, (await db.get('SELECT id FROM recurrences')).id);
  await runRecurrences(db, '2026-11-02');
  const next = await db.all("SELECT username FROM activities WHERE startDate = '2026-11-02' ORDER BY username");
  assert.deepEqual(next.map(x => x.username), ['Ana', 'Eva']);
});

test('un usuario borrado sale de la serie; sin nadie la serie se detiene; vaciar el tablero de uno no la detiene', async () => {
  const db = await makeDb();
  await ch(db, { id: 'a1', to: 'both', by: 'Ana', usernames: ['Beto', 'Eva'], repeat: 'weekly', repeatDay: 1 }, today);
  await dropSeriesWhere(db, 'username', 'Ana'); // limpiar el tablero de Ana
  assert.equal((await db.get('SELECT COUNT(*) n FROM recurrences')).n, 1);
  await removeUserFromSeries(db, 'beto');
  assert.deepEqual(JSON.parse((await db.get('SELECT participants p FROM recurrences')).p), ['Ana', 'Eva']);
  await db.run("DELETE FROM users WHERE username IN ('Ana','Eva')");
  assert.equal(await runRecurrences(db, '2026-11-02'), 0); // nadie existe: se detiene
  assert.equal((await db.get('SELECT COUNT(*) n FROM recurrences')).n, 0);
  assert.equal((await db.get("SELECT COUNT(*) n FROM activities WHERE seriesId IS NOT NULL")).n, 0);
});

test('en una serie de equipo solo reciben la tarea los miembros actuales del equipo', async () => {
  const db = await makeDb();
  await db.run('INSERT INTO teams VALUES (\'t1\',\'Eq\',\'["Ana","Beto","Eva"]\',\'x\')');
  await db.run("UPDATE activities SET teamId = 't1' WHERE id = 'a1'");
  await ch(db, { id: 'a1', to: 'both', by: 'Ana', usernames: ['Beto', 'Eva'], repeat: 'weekly', repeatDay: 1 }, today);
  await db.run('UPDATE teams SET memberUsernames = \'["Ana","Beto"]\' WHERE id = \'t1\''); // Eva salió del equipo
  await runRecurrences(db, '2026-11-02');
  const next = await db.all("SELECT username FROM activities WHERE startDate = '2026-11-02' ORDER BY username");
  assert.deepEqual(next.map(x => x.username), ['Ana', 'Beto']);
});

// ── Changing WHEN a series repeats ──────────────────────────────────────────────────────────

test('cambiar cuándo se repite una serie: nueva regla y la siguiente se cuenta desde hoy (no crea una ya pasada)', async () => {
  const db = await makeDb();
  await ch(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'weekly', repeatDay: 1 }, today); // lunes
  const { changeSeriesRule } = await import('./recurrence.ts');
  const r = await changeSeriesRule(db, { id: 'a1', by: 'Ana', repeat: 'monthly', repeatDay: 15 }, '2026-10-30');
  assert.ok(r.ok);
  const s = await db.get('SELECT repeat, day, month, lastDate FROM recurrences');
  assert.deepEqual({ ...s }, { repeat: 'monthly', day: 15, month: null, lastDate: '2026-10-30' });
  assert.equal(await runRecurrences(db, '2026-10-31'), 0); // nada vencido: la siguiente es el 15 de noviembre
  assert.equal(await runRecurrences(db, '2026-11-15'), 1);
});

test('cambiar el día de una rutina (compartida y repetitiva) aplica a la serie; solo participantes o admin', async () => {
  const db = await makeDb();
  await ch(db, { id: 'a1', to: 'both', by: 'Ana', usernames: ['Beto'], repeat: 'weekly', repeatDay: 1 }, today);
  const { changeSeriesRule } = await import('./recurrence.ts');
  const beto = (await db.get("SELECT id FROM activities WHERE username = 'Beto'")).id;
  assert.deepEqual(await changeSeriesRule(db, { id: beto, by: 'Eva', repeat: 'weekly', repeatDay: 3 }, today), { ok: false, error: 'forbidden' });
  assert.ok((await changeSeriesRule(db, { id: beto, by: 'Beto', repeat: 'weekly', repeatDay: 3 }, today)).ok);
  assert.equal((await db.get('SELECT day FROM recurrences')).day, 3);
  assert.ok((await changeSeriesRule(db, { id: beto, by: 'Luis', repeat: 'biweekly', repeatDay: 5 }, today)).ok); // un admin también
});

test('cambiar la regla: tarea inexistente, sin serie o frecuencia inválida', async () => {
  const db = await makeDb();
  const { changeSeriesRule } = await import('./recurrence.ts');
  assert.deepEqual(await changeSeriesRule(db, { id: 'zz', by: 'Ana', repeat: 'weekly' }, today), { ok: false, error: 'not_found' });
  assert.deepEqual(await changeSeriesRule(db, { id: 'a1', by: 'Ana', repeat: 'weekly' }, today), { ok: false, error: 'no_series' });
  await ch(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'weekly', repeatDay: 1 }, today);
  assert.deepEqual(await changeSeriesRule(db, { id: 'a1', by: 'Ana', repeat: 'cada rato' }, today), { ok: false, error: 'invalid_repeat' });
  assert.deepEqual(await changeSeriesRule(db, { id: 'a1', by: 'Fantasma', repeat: 'weekly' }, today), { ok: false, error: 'forbidden' });
});
