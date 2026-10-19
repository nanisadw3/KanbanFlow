import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { changeUserRole } from './roles.ts';

const opts = { minPasswordLength: 4, hashPassword: async (p: string) => `hash(${p})` };

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (username TEXT PRIMARY KEY, fullName TEXT, role TEXT, lastLogin TEXT, passwordHash TEXT, email TEXT);
    INSERT INTO users (username, role, passwordHash) VALUES
      ('Inaki', 'admin', 'hash(inaki)'), ('Roberto', 'admin', 'hash(roberto)'),
      ('Ana', 'user', NULL), ('admin', 'admin', 'hash(admin)');
  `);
  return db;
}
const row = (db: Database, u: string) => db.get<{ role: string; passwordHash: string | null }>('SELECT role, passwordHash FROM users WHERE username = ?', [u]);
const change = (db: Database, over: Record<string, unknown>) =>
  changeUserRole(db, { manager: 'Inaki', username: 'Ana', role: 'admin', password: 'clave1', ...over }, opts);

test('Inaki asciende a un usuario a administrador y se guarda su contraseña', async () => {
  const db = await makeDb();
  assert.deepEqual(await change(db, {}), { ok: true, role: 'admin' });
  assert.deepEqual(await row(db, 'Ana'), { role: 'admin', passwordHash: 'hash(clave1)' });
});

test('ascender sin contraseña, o con una muy corta, se rechaza y no cambia nada', async () => {
  const db = await makeDb();
  assert.deepEqual(await change(db, { password: undefined }), { ok: false, error: 'password_required' });
  assert.deepEqual(await change(db, { password: '' }), { ok: false, error: 'password_required' });
  assert.deepEqual(await change(db, { password: 'abc' }), { ok: false, error: 'too_short' });
  assert.deepEqual(await row(db, 'Ana'), { role: 'user', passwordHash: null });
});

test('degradar a un administrador lo deja como usuario y borra su contraseña', async () => {
  const db = await makeDb();
  assert.deepEqual(await change(db, { username: 'Roberto', role: 'user', password: undefined }), { ok: true, role: 'user' });
  assert.deepEqual(await row(db, 'Roberto'), { role: 'user', passwordHash: null });
});

test('solo Inaki puede cambiar roles (sin distinguir mayúsculas); cualquier otro admin, no', async () => {
  const db = await makeDb();
  assert.deepEqual(await change(db, { manager: 'Roberto' }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await change(db, { manager: 'admin' }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await row(db, 'Ana'), { role: 'user', passwordHash: null });
  assert.deepEqual(await change(db, { manager: 'INAKI' }), { ok: true, role: 'admin' });
});

test('no se puede cambiar el rol propio ni el de la cuenta integrada admin', async () => {
  const db = await makeDb();
  assert.deepEqual(await change(db, { username: 'inaki', role: 'user' }), { ok: false, error: 'self' });
  assert.deepEqual(await change(db, { username: 'ADMIN', role: 'user' }), { ok: false, error: 'protected' });
  assert.equal((await row(db, 'Inaki'))!.role, 'admin');
  assert.equal((await row(db, 'admin'))!.role, 'admin');
});

test('usuario inexistente o rol inválido', async () => {
  const db = await makeDb();
  assert.deepEqual(await change(db, { username: 'Nadie' }), { ok: false, error: 'not_found' });
  assert.deepEqual(await change(db, { username: 42 }), { ok: false, error: 'not_found' });
  assert.deepEqual(await change(db, { role: 'superadmin' }), { ok: false, error: 'invalid_role' });
  assert.deepEqual(await change(db, { role: undefined }), { ok: false, error: 'invalid_role' });
});

test('ascender a quien ya es admin no le cambia la contraseña', async () => {
  const db = await makeDb();
  assert.deepEqual(await change(db, { username: 'Roberto', password: 'otra-clave' }), { ok: true, role: 'admin' });
  assert.equal((await row(db, 'Roberto'))!.passwordHash, 'hash(roberto)');
});

test('el usuario se busca sin distinguir mayúsculas', async () => {
  const db = await makeDb();
  assert.deepEqual(await change(db, { username: 'aNa' }), { ok: true, role: 'admin' });
  assert.equal((await row(db, 'Ana'))!.role, 'admin');
});
