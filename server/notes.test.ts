import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { ensureNotesTable, addNote, deleteNote, pruneNotes, noteRecipient, createNoteThrottle } from './notes.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (username TEXT PRIMARY KEY, role TEXT);
    CREATE TABLE activities (id TEXT PRIMARY KEY, username TEXT, kind TEXT);
    INSERT INTO users VALUES ('Ana','user'), ('Beto','user'), ('Luis','admin'), ('Pia','power'), ('Vic','viewer');
    INSERT INTO activities VALUES ('a1','Ana','single'), ('a2','Ana','shared'), ('a4','Ana','recurring');
  `);
  await ensureNotesTable(db);
  return db;
}

test('el dueño anota en una tarea individual o repetitiva', async () => {
  const db = await makeDb();
  assert.deepEqual(await addNote(db, { activityId: 'a1', username: 'ana', text: '  Llamé al cliente ' }), { ok: true });
  assert.deepEqual(await addNote(db, { activityId: 'a4', username: 'Ana', text: 'hecho' }), { ok: true });
  const rows = await db.all('SELECT text FROM task_notes WHERE activityId = ?', ['a1']);
  assert.equal(rows[0].text, 'Llamé al cliente');
});

test('rechaza vacío, desconocidos, ajenos, y compartidas; el admin sí puede', async () => {
  const db = await makeDb();
  assert.deepEqual(await addNote(db, { activityId: 'a1', username: 'Ana', text: '   ' }), { ok: false, error: 'invalid_comment' });
  assert.deepEqual(await addNote(db, { activityId: 'zz', username: 'Ana', text: 'x' }), { ok: false, error: 'not_found' });
  assert.deepEqual(await addNote(db, { activityId: 'a1', username: 'Beto', text: 'x' }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await addNote(db, { activityId: 'a2', username: 'Ana', text: 'x' }), { ok: false, error: 'not_supported' });
  assert.deepEqual(await addNote(db, { activityId: 'a1', username: 'Luis', text: 'x' }), { ok: true });
});

test('borrar: autor o admin; prune quita las notas de tareas que ya no existen', async () => {
  const db = await makeDb();
  await addNote(db, { activityId: 'a1', username: 'Ana', text: 'uno' });
  const id = (await db.get<{ id: string }>('SELECT id FROM task_notes'))!.id;
  assert.deepEqual(await deleteNote(db, { id, username: 'Beto' }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await deleteNote(db, { id, username: 'Ana' }), { ok: true });
  await addNote(db, { activityId: 'a1', username: 'Ana', text: 'dos' });
  await db.run("DELETE FROM activities WHERE id = 'a1'");
  await pruneNotes(db);
  assert.equal((await db.all('SELECT * FROM task_notes')).length, 0);
});

test('un power user anota y borra notas en tareas ajenas; un visor no', async () => {
  const db = await makeDb();
  assert.deepEqual(await addNote(db, { activityId: 'a1', username: 'Pia', text: 'Revisado' }), { ok: true });
  assert.deepEqual(await addNote(db, { activityId: 'a4', username: 'pia', text: 'Va bien' }), { ok: true });
  assert.deepEqual(await addNote(db, { activityId: 'a1', username: 'Vic', text: 'x' }), { ok: false, error: 'forbidden' });
  const id = (await db.get<{ id: string }>("SELECT id FROM task_notes WHERE username = 'Pia' LIMIT 1"))!.id;
  assert.deepEqual(await deleteNote(db, { id, username: 'Vic' }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await deleteNote(db, { id, username: 'Pia' }), { ok: true });
});

// ── Aviso al dueño ──────────────────────────────────────────────────────────────────────────

async function makeMailDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (username TEXT PRIMARY KEY, role TEXT, fullName TEXT, email TEXT);
    CREATE TABLE activities (id TEXT PRIMARY KEY, username TEXT, kind TEXT, title TEXT, description TEXT, endDate TEXT, priority TEXT, seriesId TEXT);
    INSERT INTO users VALUES ('Ana','user','Ana Pérez','ana@x.com'), ('Beto','user','Beto Ruiz','beto@x.com'),
      ('Sin','user','Sin Correo',NULL), ('Pia','power','Pia Poder','pia@x.com');
    INSERT INTO activities VALUES ('t1','Ana','single','Informe','d','2026-12-01','alta',NULL),
      ('t2','Ana','recurring','Reporte semanal','','','media','ser1'), ('t3','Sin','single','Sin aviso','','','media',NULL);
  `);
  return db;
}

test('noteRecipient: avisa al dueño cuando otra persona anota; nunca al propio autor', async () => {
  const db = await makeMailDb();
  const r = await noteRecipient(db, 't1', 'pia');
  assert.equal(r?.owner.email, 'ana@x.com');
  assert.equal(r?.authorName, 'Pia Poder');
  assert.equal(r?.task.title, 'Informe');
  assert.equal(r?.task.repeating, false);
  assert.equal((await noteRecipient(db, 't2', 'Beto'))?.task.repeating, true);
  assert.equal(await noteRecipient(db, 't1', 'ANA'), null); // el dueño anotando en su propia tarea
});

test('noteRecipient: nadie a quien avisar si el dueño no tiene correo o la tarea/autor no existen', async () => {
  const db = await makeMailDb();
  assert.equal(await noteRecipient(db, 't3', 'Pia'), null);
  assert.equal(await noteRecipient(db, 'nope', 'Pia'), null);
  assert.equal(await noteRecipient(db, 't1', 'nadie'), null);
});

test('createNoteThrottle: un correo por tarea cada ventana; otra tarea no se ve afectada', () => {
  const th = createNoteThrottle(1000);
  assert.equal(th.allow('t1', 0), true);
  assert.equal(th.allow('t1', 500), false);
  assert.equal(th.allow('t2', 500), true);
  assert.equal(th.allow('t1', 1000), true);
  assert.equal(th.allow('t1', 1500), false);
});
