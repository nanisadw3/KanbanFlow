import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { updateProfile, parsePhoto, isValidUsername, MAX_PHOTO_BYTES } from './profile.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (username TEXT PRIMARY KEY, fullName TEXT, role TEXT, lastLogin TEXT, email TEXT, photo TEXT, photoUpdatedAt TEXT);
    CREATE TABLE activities (id TEXT PRIMARY KEY, username TEXT, assignedBy TEXT);
    CREATE TABLE teams (id TEXT PRIMARY KEY, memberUsernames TEXT);
    CREATE TABLE comments (id TEXT PRIMARY KEY, username TEXT);
    CREATE TABLE comment_reads (username TEXT, sharedId TEXT);
    CREATE TABLE recurrences (id TEXT PRIMARY KEY, username TEXT, assignedBy TEXT);
    CREATE TABLE presence (username TEXT PRIMARY KEY);
    INSERT INTO users (username, fullName, role, lastLogin, email) VALUES
      ('Ana','Ana P','user','x','ana@x.com'), ('Beto','Beto R','user','x','beto@x.com'),
      ('Inaki','Inaki S','admin','x','i@x.com'), ('admin','Admin','admin','x','a@x.com');
    INSERT INTO activities VALUES ('1','Ana','Beto'), ('2','Beto','ana'), ('3','Beto',NULL);
    INSERT INTO teams VALUES ('t1', '["Ana","Beto"]'), ('t2', '["Beto"]');
    INSERT INTO comments VALUES ('c1','Ana'), ('c2','Beto');
    INSERT INTO comment_reads VALUES ('Ana','s'), ('Beto','s');
    INSERT INTO recurrences VALUES ('s1','Ana','Beto'), ('s2','Beto','Ana');
    INSERT INTO presence VALUES ('Ana'), ('Beto');
  `);
  return db;
}

// 1x1 PNG, JPEG header and a WEBP header: enough to pass the byte check.
const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const webp = 'data:image/webp;base64,' + Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), Buffer.from([5])]).toString('base64');

test('parsePhoto acepta jpeg/png/webp reales y rechaza el resto', () => {
  assert.equal(parsePhoto(png)?.mime, 'image/png');
  assert.equal(parsePhoto(jpeg)?.mime, 'image/jpeg');
  assert.equal(parsePhoto(webp)?.mime, 'image/webp');
  assert.equal(parsePhoto('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), null);          // svg puede traer scripts
  assert.equal(parsePhoto('data:image/png;base64,' + Buffer.from('<html>').toString('base64')), null); // no es un png de verdad
  assert.equal(parsePhoto('https://x.com/a.png'), null);
  assert.equal(parsePhoto(42), null);
  const big = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_PHOTO_BYTES)]).toString('base64');
  assert.equal(parsePhoto(big), null);
});

test('isValidUsername: letras, números, punto, guion y guion bajo', () => {
  assert.equal(isValidUsername('carlos.99'), true);
  assert.equal(isValidUsername('Íñigo_Z'), true);
  assert.equal(isValidUsername('con espacio'), false);
  assert.equal(isValidUsername(''), false);
  assert.equal(isValidUsername('a'.repeat(33)), false);
  assert.equal(isValidUsername('<b>'), false);
});

test('cambia nombre y correo sin tocar lo demás', async () => {
  const db = await makeDb();
  assert.deepEqual(await updateProfile(db, 'ana', { fullName: '  Ana María  ', email: 'nueva@x.com' }), { ok: true, username: 'Ana' });
  const u = await db.get("SELECT * FROM users WHERE username = 'Ana'");
  assert.equal(u.fullName, 'Ana María');
  assert.equal(u.email, 'nueva@x.com');
  assert.equal(u.role, 'user');
});

test('rechaza nombre vacío o correo inválido sin escribir nada', async () => {
  const db = await makeDb();
  assert.deepEqual(await updateProfile(db, 'Ana', { fullName: ' ', email: 'otra@x.com' }), { ok: false, error: 'invalid_name' });
  assert.deepEqual(await updateProfile(db, 'Ana', { fullName: 'Nuevo', email: 'no-es-correo' }), { ok: false, error: 'invalid_email' });
  const u = await db.get("SELECT fullName, email FROM users WHERE username = 'Ana'");
  assert.deepEqual({ ...u }, { fullName: 'Ana P', email: 'ana@x.com' });
  assert.deepEqual(await updateProfile(db, 'Fantasma', { fullName: 'X' }), { ok: false, error: 'not_found' });
});

test('renombrar propaga el nombre a tareas, equipos, comentarios, series y presencia', async () => {
  const db = await makeDb();
  assert.deepEqual(await updateProfile(db, 'Ana', { newUsername: 'ana.lopez' }), { ok: true, username: 'ana.lopez' });
  assert.equal((await db.get("SELECT COUNT(*) n FROM users WHERE username = 'Ana'")).n, 0);
  assert.equal((await db.get("SELECT username FROM activities WHERE id = '1'")).username, 'ana.lopez');
  assert.equal((await db.get("SELECT assignedBy FROM activities WHERE id = '2'")).assignedBy, 'ana.lopez'); // 'ana' en minúsculas también
  assert.equal((await db.get("SELECT assignedBy FROM activities WHERE id = '1'")).assignedBy, 'Beto');
  assert.equal((await db.get("SELECT memberUsernames m FROM teams WHERE id = 't1'")).m, '["ana.lopez","Beto"]');
  assert.equal((await db.get("SELECT memberUsernames m FROM teams WHERE id = 't2'")).m, '["Beto"]');
  assert.equal((await db.get("SELECT username FROM comments WHERE id = 'c1'")).username, 'ana.lopez');
  assert.equal((await db.get("SELECT COUNT(*) n FROM comment_reads WHERE username = 'ana.lopez'")).n, 1); // sus marcas de lectura la siguen
  assert.equal((await db.get("SELECT username FROM recurrences WHERE id = 's1'")).username, 'ana.lopez');
  assert.equal((await db.get("SELECT assignedBy FROM recurrences WHERE id = 's2'")).assignedBy, 'ana.lopez');
  assert.equal((await db.get("SELECT COUNT(*) n FROM presence WHERE username = 'Ana'")).n, 0);
  assert.equal((await db.get("SELECT COUNT(*) n FROM presence WHERE username = 'Beto'")).n, 1);
});

test('renombrar: no a un nombre ocupado (sin importar mayúsculas), ni inválido, ni reservado', async () => {
  const db = await makeDb();
  assert.deepEqual(await updateProfile(db, 'Ana', { newUsername: 'BETO' }), { ok: false, error: 'exists' });
  assert.deepEqual(await updateProfile(db, 'Ana', { newUsername: 'dos palabras' }), { ok: false, error: 'invalid_username' });
  assert.deepEqual(await updateProfile(db, 'Ana', { newUsername: 'Admin' }), { ok: false, error: 'protected' });
  assert.deepEqual(await updateProfile(db, 'Ana', { newUsername: 'inaki' }), { ok: false, error: 'protected' });
  assert.equal((await db.get("SELECT COUNT(*) n FROM users WHERE username = 'Ana'")).n, 1);
});

test('las cuentas admin e inaki no se pueden renombrar, ni siquiera cambiando mayúsculas', async () => {
  const db = await makeDb();
  assert.deepEqual(await updateProfile(db, 'admin', { newUsername: 'jefe' }), { ok: false, error: 'protected' });
  assert.deepEqual(await updateProfile(db, 'Inaki', { newUsername: 'inaki2' }), { ok: false, error: 'protected' });
  assert.deepEqual(await updateProfile(db, 'Inaki', { newUsername: 'INAKI' }), { ok: false, error: 'protected' });
  // pero su nombre y correo sí se pueden editar
  assert.deepEqual(await updateProfile(db, 'Inaki', { fullName: 'Iñaki S', newUsername: 'Inaki' }), { ok: true, username: 'Inaki' });
});

test('cambiar solo mayúsculas del propio nombre es válido', async () => {
  const db = await makeDb();
  assert.deepEqual(await updateProfile(db, 'Ana', { newUsername: 'ANA' }), { ok: true, username: 'ANA' });
  assert.equal((await db.get("SELECT username FROM activities WHERE id = '1'")).username, 'ANA');
});

test('la foto se guarda, se reemplaza y se quita', async () => {
  const db = await makeDb();
  const t1 = new Date('2026-10-28T10:00:00Z');
  assert.deepEqual(await updateProfile(db, 'Ana', { photo: png }, t1), { ok: true, username: 'Ana' });
  let u = await db.get("SELECT photo, photoUpdatedAt FROM users WHERE username = 'Ana'");
  assert.equal(u.photo, png);
  assert.equal(u.photoUpdatedAt, t1.toISOString());
  await updateProfile(db, 'Ana', { photo: jpeg }, new Date('2026-10-29T10:00:00Z'));
  u = await db.get("SELECT photo, photoUpdatedAt FROM users WHERE username = 'Ana'");
  assert.equal(u.photo, jpeg);
  assert.equal(u.photoUpdatedAt, '2026-10-29T10:00:00.000Z');
  await updateProfile(db, 'Ana', { photo: null });
  u = await db.get("SELECT photo, photoUpdatedAt FROM users WHERE username = 'Ana'");
  assert.equal(u.photo, null);
  assert.equal(u.photoUpdatedAt, null);
});

test('una foto inválida se rechaza y no cambia nada más', async () => {
  const db = await makeDb();
  assert.deepEqual(await updateProfile(db, 'Ana', { fullName: 'Otra', photo: 'data:image/png;base64,AAAA' }), { ok: false, error: 'invalid_photo' });
  assert.equal((await db.get("SELECT fullName FROM users WHERE username = 'Ana'")).fullName, 'Ana P');
});

test('sin campos no cambia nada', async () => {
  const db = await makeDb();
  assert.deepEqual(await updateProfile(db, 'Ana', {}), { ok: true, username: 'Ana' });
});
