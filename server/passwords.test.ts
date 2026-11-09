import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { setPasswordFor } from './passwords.ts';

const opts = { minPasswordLength: 4, hashPassword: async (p: string) => `hash(${p})` };

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (username TEXT PRIMARY KEY, role TEXT, passwordHash TEXT);
    INSERT INTO users VALUES ('Inaki','admin','hash(inaki)'), ('Roberto','admin','hash(roberto)'), ('Pia','power','hash(pia)'),
      ('Pol','power',NULL), ('Ana','user',NULL), ('Vera','viewer',NULL), ('admin','admin','hash(admin)');
  `);
  return db;
}
const hash = (db: Database, u: string) => db.get<{ passwordHash: string | null }>('SELECT passwordHash FROM users WHERE username = ?', [u]).then(r => r?.passwordHash);
const set = (db: Database, over: Record<string, unknown>) => setPasswordFor(db, { manager: 'Inaki', username: 'Roberto', newPassword: 'nueva1', ...over }, opts);

test('Inaki cambia la contraseña de un administrador, de un power user y de la cuenta integrada admin', async () => {
  const db = await makeDb();
  assert.deepEqual(await set(db, {}), { ok: true, username: 'Roberto' });
  assert.equal(await hash(db, 'Roberto'), 'hash(nueva1)');
  assert.deepEqual(await set(db, { username: 'pia' }), { ok: true, username: 'Pia' });
  assert.equal(await hash(db, 'Pia'), 'hash(nueva1)');
  assert.deepEqual(await set(db, { username: 'admin' }), { ok: true, username: 'admin' });
  assert.equal(await hash(db, 'admin'), 'hash(nueva1)');
});

test('un power user que nunca tuvo contraseña la recibe por esta vía', async () => {
  const db = await makeDb();
  assert.deepEqual(await set(db, { username: 'Pol' }), { ok: true, username: 'Pol' });
  assert.equal(await hash(db, 'Pol'), 'hash(nueva1)');
});

test('solo Inaki (sin distinguir mayúsculas): cualquier otra persona, aunque sea administradora, no puede', async () => {
  const db = await makeDb();
  assert.deepEqual(await set(db, { manager: 'INAKI' }), { ok: true, username: 'Roberto' });
  assert.deepEqual(await set(db, { manager: 'Roberto', username: 'Pia' }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await set(db, { manager: 'Pia' }), { ok: false, error: 'forbidden' });
  assert.equal(await hash(db, 'Pia'), 'hash(pia)');
});

test('cuentas sin contraseña (usuario normal, visor), inexistentes y contraseñas cortas se rechazan sin cambiar nada', async () => {
  const db = await makeDb();
  assert.deepEqual(await set(db, { username: 'Ana' }), { ok: false, error: 'not_supported' });
  assert.deepEqual(await set(db, { username: 'Vera' }), { ok: false, error: 'not_supported' });
  assert.deepEqual(await set(db, { username: 'Nadie' }), { ok: false, error: 'not_found' });
  assert.deepEqual(await set(db, { newPassword: 'abc' }), { ok: false, error: 'too_short' });
  assert.deepEqual(await set(db, { newPassword: undefined }), { ok: false, error: 'too_short' });
  assert.equal(await hash(db, 'Roberto'), 'hash(roberto)');
  assert.equal(await hash(db, 'Ana'), null);
});
