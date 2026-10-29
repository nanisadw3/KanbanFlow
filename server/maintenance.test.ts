import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { ensureSettingsTable } from './settings.ts';
import { getNotice, startNotice, endNotice, DEFAULT_NOTICE, MAX_NOTICE_LENGTH } from './maintenance.ts';
import { maintenanceMessage } from './emailTemplates.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await ensureSettingsTable(db);
  return db;
}

test('sin aviso no hay nada; al iniciar se guarda y se puede leer', async () => {
  const db = await makeDb();
  assert.equal(await getNotice(db), null);
  const r = await startNotice(db, 'Inaki', '  Cambio de base de datos  ', new Date('2026-10-29T10:00:00Z'));
  assert.ok(r.ok);
  assert.deepEqual(await getNotice(db), { message: 'Cambio de base de datos', startedAt: '2026-10-29T10:00:00.000Z', by: 'Inaki' });
});

test('sin mensaje usa el texto por defecto', async () => {
  const db = await makeDb();
  await startNotice(db, 'inaki', '   ');
  assert.equal((await getNotice(db))?.message, DEFAULT_NOTICE);
});

test('solo inaki puede iniciar o terminar el aviso', async () => {
  const db = await makeDb();
  assert.deepEqual(await startNotice(db, 'Roberto', 'x'), { ok: false, error: 'forbidden' });
  assert.equal(await getNotice(db), null);
  await startNotice(db, 'INAKI', 'x');
  assert.deepEqual(await endNotice(db, 'Roberto'), { ok: false, error: 'forbidden' });
  assert.ok(await getNotice(db));
  assert.deepEqual(await endNotice(db, 'Inaki'), { ok: true });
  assert.equal(await getNotice(db), null);
});

test('un mensaje demasiado largo se rechaza', async () => {
  const db = await makeDb();
  assert.deepEqual(await startNotice(db, 'Inaki', 'a'.repeat(MAX_NOTICE_LENGTH + 1)), { ok: false, error: 'too_long' });
});

test('el correo escapa el mensaje y saluda por el primer nombre', () => {
  const m = maintenanceMessage('<b>hola</b> & más', { name: 'Ruben Alberto' });
  assert.match(m.subject, /mantenimiento/i);
  assert.ok(m.html.includes('&lt;b&gt;hola&lt;/b&gt; &amp; más'));
  assert.ok(!m.html.includes('<b>hola</b>'));
  assert.ok(m.text.includes('Ruben'));
  assert.ok(!m.html.includes('Si ya atendiste esta tarea'));
});
