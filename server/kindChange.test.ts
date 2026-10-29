import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { changeKind } from './kindChange.ts';
import { createSharedTask, ensureCommentsTable, ensureCommentReadsTable, addComment, pruneComments } from './shared.ts';
import { ensureRecurrenceTable } from './recurrence.ts';

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
const sharedBase = { title: 'T', description: '', startDate: '2026-10-01', endDate: '2026-10-09', priority: 'media' as const, assignedBy: 'Ana', teamId: null };

test('individual → compartida: conserva su avance y suma copias en todo/0%', async () => {
  const db = await makeDb();
  const r = await changeKind(db, { id: 'a1', to: 'shared', by: 'Ana', usernames: ['Beto', 'eva', 'nadie'] }, today);
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
  const r = await changeKind(db, { id: 'a1', to: 'shared', by: 'Ana', usernames: ['Beto'], fields: { endDate: '' } }, today);
  assert.deepEqual(r, { ok: false, error: 'invalid_dates' });
  assert.equal((await db.get("SELECT kind FROM activities WHERE id = 'a1'")).kind, 'single');
});

test('individual → repetitiva: crea la serie y la tarea queda sin fecha de fin', async () => {
  const db = await makeDb();
  const r = await changeKind(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'weekly', repeatDay: 3 }, today);
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
  assert.deepEqual(await changeKind(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'cada rato' }, today), { ok: false, error: 'invalid_repeat' });
});

test('compartida → individual: quita las copias ajenas y sus comentarios; conserva la de quien la cambia', async () => {
  const db = await makeDb();
  const { sharedId, ids } = await createSharedTask(db, { ...sharedBase, usernames: ['Ana', 'Beto'] });
  await addComment(db, { sharedId, username: 'Beto', text: 'hola' });
  const r = await changeKind(db, { id: ids[0], to: 'single', by: 'Ana' }, today);
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
  assert.deepEqual(await changeKind(db, { id: ids[0], to: 'single', by: 'Eva' }, today), { ok: false, error: 'forbidden' });
  assert.deepEqual(await changeKind(db, { id: ids[0], to: 'single', by: 'Fantasma' }, today), { ok: false, error: 'forbidden' });
  assert.ok((await changeKind(db, { id: ids[0], to: 'single', by: 'Luis' }, today)).ok);
});

test('repetitiva → individual: detiene la serie y la tarea queda normal', async () => {
  const db = await makeDb();
  await changeKind(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'monthly', repeatDay: 5 }, today);
  const r = await changeKind(db, { id: 'a1', to: 'single', by: 'Ana' }, today);
  assert.ok(r.ok);
  assert.equal((await db.get('SELECT COUNT(*) n FROM recurrences')).n, 0);
  assert.deepEqual({ ...(await db.get("SELECT kind, seriesId FROM activities WHERE id = 'a1'")) }, { kind: 'single', seriesId: null });
});

test('repetitiva → compartida y compartida → repetitiva', async () => {
  const db = await makeDb();
  await changeKind(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'weekly', repeatDay: 1 }, today);
  const r = await changeKind(db, { id: 'a1', to: 'shared', by: 'Ana', usernames: ['Beto'], fields: { startDate: '2026-10-01', endDate: '2026-10-20' } }, today);
  assert.ok(r.ok);
  assert.equal((await db.get('SELECT COUNT(*) n FROM recurrences')).n, 0);
  assert.equal((await db.get("SELECT COUNT(*) n FROM activities WHERE kind = 'shared'")).n, 2);
  const back = await changeKind(db, { id: 'a1', to: 'recurring', by: 'Ana', repeat: 'weekly', repeatDay: 2 }, today);
  assert.ok(back.ok);
  assert.equal((await db.get('SELECT COUNT(*) n FROM activities')).n, 1); // la copia de Beto se fue
});

test('mismo tipo, tarea inexistente y tipo inválido', async () => {
  const db = await makeDb();
  assert.deepEqual(await changeKind(db, { id: 'a1', to: 'single', by: 'Ana' }, today), { ok: false, error: 'same_kind' });
  assert.deepEqual(await changeKind(db, { id: 'zz', to: 'shared', by: 'Ana' }, today), { ok: false, error: 'not_found' });
  assert.deepEqual(await changeKind(db, { id: 'a1', to: 'otro', by: 'Ana' }, today), { ok: false, error: 'invalid_kind' });
});

test('en una tarea de equipo solo se suman miembros del equipo', async () => {
  const db = await makeDb();
  await db.run('INSERT INTO teams VALUES (\'t1\',\'Eq\',\'["Ana","Beto"]\',\'x\')');
  await db.run("UPDATE activities SET teamId = 't1' WHERE id = 'a1'");
  const r = await changeKind(db, { id: 'a1', to: 'shared', by: 'Ana', usernames: ['Beto', 'Eva'] }, today);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.added, ['Beto']);
});
