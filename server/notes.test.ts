import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { ensureNotesTable, addNote, deleteNote, pruneNotes } from './notes.ts';

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
