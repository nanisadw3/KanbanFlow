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

test('power user: necesita contraseña (como el admin); el visor no', async () => {
  const db = await makeDb();
  assert.deepEqual(await change(db, { role: 'power', password: undefined }), { ok: false, error: 'password_required' });
  assert.deepEqual(await change(db, { role: 'power', password: 'abc' }), { ok: false, error: 'too_short' });
  assert.deepEqual(await row(db, 'Ana'), { role: 'user', passwordHash: null });
  assert.deepEqual(await change(db, { role: 'power', password: 'clave1' }), { ok: true, role: 'power' });
  assert.deepEqual(await row(db, 'Ana'), { role: 'power', passwordHash: 'hash(clave1)' });
  // the viewer signs in with just the username: no password asked, and any old one is dropped
  assert.deepEqual(await change(db, { role: 'viewer', password: undefined }), { ok: true, role: 'viewer' });
  assert.deepEqual(await row(db, 'Ana'), { role: 'viewer', passwordHash: null });
});

test('guardar de nuevo el rol power no le cambia la contraseña; si no tenía una, sí se la pone', async () => {
  const db = await makeDb();
  await change(db, { role: 'power', password: 'clave1' });
  assert.deepEqual(await change(db, { role: 'power', password: 'otra123' }), { ok: true, role: 'power' });
  assert.deepEqual(await row(db, 'Ana'), { role: 'power', passwordHash: 'hash(clave1)' });
  await db.run("UPDATE users SET passwordHash = NULL WHERE username = 'Ana'");
  assert.deepEqual(await change(db, { role: 'power', password: 'nueva99' }), { ok: true, role: 'power' });
  assert.deepEqual(await row(db, 'Ana'), { role: 'power', passwordHash: 'hash(nueva99)' });
});

test('pasar un administrador a power user pide una contraseña nueva; rol inválido se rechaza', async () => {
  const db = await makeDb();
  assert.deepEqual(await change(db, { username: 'Roberto', role: 'power', password: undefined }), { ok: false, error: 'password_required' });
  assert.deepEqual(await change(db, { username: 'Roberto', role: 'power', password: 'clave1' }), { ok: true, role: 'power' });
  assert.deepEqual(await row(db, 'Roberto'), { role: 'power', passwordHash: 'hash(clave1)' });
  assert.deepEqual(await change(db, { username: 'Ana', role: 'superjefe' }), { ok: false, error: 'invalid_role' });
});
