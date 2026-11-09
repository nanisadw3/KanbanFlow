import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { updateTeam } from './teams.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (username TEXT PRIMARY KEY, role TEXT);
    CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT, memberUsernames TEXT, createdAt TEXT);
    INSERT INTO users VALUES ('Ana','user'),('Beto','user'),('Eva','user'),('Luis','admin'),('admin','admin');
    INSERT INTO teams VALUES ('t1','Ventas','["Ana","Beto"]','x'), ('t2','Soporte','["Eva"]','x');
  `);
  return db;
}

test('un admin cambia nombre y miembros; informa quién entró y quién salió', async () => {
  const db = await makeDb();
  const r = await updateTeam(db, { teamId: 't1', name: '  Ventas   Norte ', memberUsernames: ['beto', 'EVA', 'eva', 'nadie', 'admin'], by: 'luis' });
  assert.deepEqual(r, { ok: true, removed: ['Ana'], added: ['Eva'], renamed: true });
  const row = await db.get('SELECT name, memberUsernames FROM teams WHERE id = ?', ['t1']);
  assert.equal(row.name, 'Ventas Norte');
  assert.deepEqual(JSON.parse(row.memberUsernames), ['Beto', 'Eva']);
});

test('rechaza a quien no es admin, equipos que no existen, nombres vacíos o repetidos y equipos sin miembros', async () => {
  const db = await makeDb();
  assert.deepEqual(await updateTeam(db, { teamId: 't1', name: 'X', memberUsernames: ['Ana'], by: 'Ana' }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await updateTeam(db, { teamId: 'zz', name: 'X', memberUsernames: ['Ana'], by: 'Luis' }), { ok: false, error: 'not_found' });
  assert.deepEqual(await updateTeam(db, { teamId: 't1', name: '   ', memberUsernames: ['Ana'], by: 'Luis' }), { ok: false, error: 'invalid_name' });
  assert.deepEqual(await updateTeam(db, { teamId: 't1', name: 'soporte', memberUsernames: ['Ana'], by: 'Luis' }), { ok: false, error: 'name_taken' });
  assert.deepEqual(await updateTeam(db, { teamId: 't1', name: 'Ventas', memberUsernames: ['nadie'], by: 'Luis' }), { ok: false, error: 'no_members' });
  const row = await db.get('SELECT name FROM teams WHERE id = ?', ['t1']);
  assert.equal(row.name, 'Ventas');
});

test('guardar sin cambios no marca nada', async () => {
  const db = await makeDb();
  assert.deepEqual(await updateTeam(db, { teamId: 't1', name: 'Ventas', memberUsernames: ['Ana', 'Beto'], by: 'Luis' }), { ok: true, removed: [], added: [], renamed: false });
});
