import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { validateNewUser, createUser, touchLogin } from './users.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE users (username TEXT PRIMARY KEY, fullName TEXT, role TEXT NOT NULL DEFAULT 'user',
    lastLogin TEXT NOT NULL, passwordHash TEXT, email TEXT);`);
  return db;
}

const ok = { username: ' Ana ', fullName: ' Ana Pérez ', role: 'user', email: ' ana@x.com ' };

test('validateNewUser normaliza y acepta un usuario válido', () => {
  const r = validateNewUser(ok, 4);
  assert.deepEqual(r, { ok: true, user: { username: 'Ana', fullName: 'Ana Pérez', role: 'user', email: 'ana@x.com', password: '' } });
});

test('validateNewUser rechaza datos incompletos o inválidos', () => {
  assert.deepEqual(validateNewUser({ ...ok, username: '  ' }, 4), { ok: false, error: 'invalid_username' });
  assert.deepEqual(validateNewUser({ ...ok, fullName: '' }, 4), { ok: false, error: 'invalid_name' });
  assert.deepEqual(validateNewUser({ ...ok, email: 'a@b' }, 4), { ok: false, error: 'invalid_email' });
  assert.deepEqual(validateNewUser({ ...ok, role: 'admin' }, 4), { ok: false, error: 'too_short' });
  assert.deepEqual(validateNewUser({ ...ok, role: 'admin', password: 'abc' }, 4), { ok: false, error: 'too_short' });
  assert.equal(validateNewUser({ ...ok, role: 'admin', password: 'abcd' }, 4).ok, true);
});

test('validateNewUser trata un rol desconocido como usuario normal', () => {
  const r = validateNewUser({ ...ok, role: 'superadmin' }, 4);
  assert.equal(r.ok && r.user.role, 'user');
});

test('createUser inserta y rechaza duplicados sin distinguir mayúsculas', async () => {
  const db = await makeDb();
  assert.deepEqual(await createUser(db, { username: 'Ana', fullName: 'Ana P', role: 'user', email: 'a@x.com', passwordHash: null }), { ok: true });
  assert.deepEqual(await createUser(db, { username: 'ANA', fullName: 'Otra', role: 'admin', email: 'o@x.com', passwordHash: 'h' }), { ok: false, error: 'exists' });
  const rows = await db.all('SELECT username, role FROM users');
  assert.deepEqual(rows, [{ username: 'Ana', role: 'user' }]);
});

test('touchLogin NO crea usuarios que no existen', async () => {
  const db = await makeDb();
  assert.equal(await touchLogin(db, 'Fantasma', 'Nombre', 'f@x.com'), false);
  assert.equal((await db.get('SELECT COUNT(*) c FROM users')).c, 0);
});

test('touchLogin actualiza último acceso, completa nombre y correo vacíos sin pisar los existentes', async () => {
  const db = await makeDb();
  await db.run("INSERT INTO users (username, fullName, role, lastLogin, email) VALUES ('Ana', NULL, 'user', 'old', NULL), ('Beto', 'Beto Original', 'user', 'old', 'beto@x.com')");
  assert.equal(await touchLogin(db, 'Ana', 'Ana Nueva', 'ana@x.com'), true);
  assert.equal(await touchLogin(db, 'beto', 'Otro Nombre', 'otro@x.com'), true);
  const ana = await db.get("SELECT fullName, email, lastLogin FROM users WHERE username='Ana'");
  assert.equal(ana.fullName, 'Ana Nueva'); assert.equal(ana.email, 'ana@x.com'); assert.notEqual(ana.lastLogin, 'old');
  const beto = await db.get("SELECT fullName, email FROM users WHERE username='Beto'");
  assert.equal(beto.fullName, 'Beto Original'); assert.equal(beto.email, 'beto@x.com');
});
