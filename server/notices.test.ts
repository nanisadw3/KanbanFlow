import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { ensureNoticesTable, listActive, publishNotice, endNotice, DEFAULT_MAINTENANCE, MAX_NOTICE_LENGTH } from './notices.ts';
import { maintenanceMessage, announcementMessage } from './emailTemplates.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await ensureNoticesTable(db);
  return db;
}
const t0 = new Date('2026-10-29T10:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);

test('un aviso normal lo puede publicar cualquier admin y caduca solo', async () => {
  const db = await makeDb();
  const r = await publishNotice(db, { by: 'Roberto', kind: 'normal', message: ' Junta a las 4 ', minutes: 60 }, t0);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.notice.expiresAt, at(60).toISOString());
  assert.equal((await listActive(db, at(59))).length, 1);
  assert.equal((await listActive(db, at(60))).length, 0); // justo al cumplirse el tiempo ya no está
  assert.equal((await db.get('SELECT COUNT(*) n FROM notices')).n, 0); // y se borra
});

test('la duración inválida usa 1 hora; el mensaje es obligatorio en uno normal', async () => {
  const db = await makeDb();
  const r = await publishNotice(db, { by: 'Roberto', kind: 'normal', message: 'x', minutes: 7 }, t0);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.notice.expiresAt, at(60).toISOString());
  assert.deepEqual(await publishNotice(db, { by: 'Roberto', kind: 'normal', message: '   ' }, t0), { ok: false, error: 'empty' });
  assert.deepEqual(await publishNotice(db, { by: 'Roberto', kind: 'normal', message: 'a'.repeat(MAX_NOTICE_LENGTH + 1) }, t0), { ok: false, error: 'too_long' });
  assert.deepEqual(await publishNotice(db, { by: 'Roberto', kind: 'otro', message: 'x' }, t0), { ok: false, error: 'invalid_kind' });
});

test('el mantenimiento solo lo publica inaki, no caduca, usa texto por defecto y reemplaza al anterior', async () => {
  const db = await makeDb();
  assert.deepEqual(await publishNotice(db, { by: 'Roberto', kind: 'maintenance', message: '' }, t0), { ok: false, error: 'forbidden' });
  const a = await publishNotice(db, { by: 'INAKI', kind: 'maintenance', message: '' }, t0);
  assert.ok(a.ok);
  if (a.ok) { assert.equal(a.notice.message, DEFAULT_MAINTENANCE); assert.equal(a.notice.expiresAt, null); }
  await publishNotice(db, { by: 'Inaki', kind: 'maintenance', message: 'segundo' }, t0);
  const list = await listActive(db, at(100000));
  assert.deepEqual(list.map(n => n.message), ['segundo']);
});

test('la lista pone el mantenimiento primero y luego lo más nuevo', async () => {
  const db = await makeDb();
  await publishNotice(db, { by: 'Roberto', kind: 'normal', message: 'viejo', minutes: 1440 }, t0);
  await publishNotice(db, { by: 'Roberto', kind: 'normal', message: 'nuevo', minutes: 1440 }, at(5));
  await publishNotice(db, { by: 'Inaki', kind: 'maintenance', message: 'mant' }, at(1));
  assert.deepEqual((await listActive(db, at(10))).map(n => n.message), ['mant', 'nuevo', 'viejo']);
});

test('quitar un aviso: cualquier admin el normal, solo inaki el de mantenimiento', async () => {
  const db = await makeDb();
  const n = await publishNotice(db, { by: 'Roberto', kind: 'normal', message: 'x' }, t0);
  const m = await publishNotice(db, { by: 'Inaki', kind: 'maintenance', message: 'y' }, t0);
  assert.ok(n.ok && m.ok);
  if (!n.ok || !m.ok) return;
  assert.deepEqual(await endNotice(db, { by: 'Luis', id: m.notice.id }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await endNotice(db, { by: 'Luis', id: n.notice.id }), { ok: true });
  assert.deepEqual(await endNotice(db, { by: 'Luis', id: n.notice.id }), { ok: false, error: 'not_found' });
  assert.deepEqual(await endNotice(db, { by: 'inaki', id: m.notice.id }), { ok: true });
});

test('los correos escapan el mensaje', () => {
  for (const m of [maintenanceMessage('<b>hola</b> & más', { name: 'Ruben Alberto' }), announcementMessage('<b>hola</b> & más', 'Roberto', { name: 'Ruben Alberto' })]) {
    assert.ok(m.html.includes('&lt;b&gt;hola&lt;/b&gt; &amp; más'));
    assert.ok(!m.html.includes('<b>hola</b>'));
    assert.ok(m.text.includes('Ruben'));
    assert.ok(!m.html.includes('Si ya atendiste esta tarea'));
  }
});
