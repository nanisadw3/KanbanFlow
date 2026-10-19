import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { ensureSettingsTable, resolveMailConfig, saveMailConfig, publicMailSettings } from './settings.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await ensureSettingsTable(db);
  return db;
}

test('sin datos en la base, usa las variables de entorno', async () => {
  const db = await makeDb();
  const cfg = await resolveMailConfig(db, { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r', MAIL_FROM: 'f' });
  assert.deepEqual(cfg, { clientId: 'id', clientSecret: 's', refreshToken: 'r', from: 'f' });
});

test('lo guardado en la base tiene prioridad campo por campo', async () => {
  const db = await makeDb();
  await saveMailConfig(db, { clientId: 'db-id' });
  const cfg = await resolveMailConfig(db, { GMAIL_CLIENT_ID: 'env-id', GMAIL_CLIENT_SECRET: 'env-secret' });
  assert.equal(cfg.clientId, 'db-id');
  assert.equal(cfg.clientSecret, 'env-secret');
});

test('campos secretos vacíos al guardar conservan los actuales; nuevos los reemplazan', async () => {
  const db = await makeDb();
  await saveMailConfig(db, { clientId: 'id', clientSecret: 'secreto', refreshToken: 'token' });
  await saveMailConfig(db, { clientId: 'id2', clientSecret: '', refreshToken: '' });
  const kept = await resolveMailConfig(db, {});
  assert.equal(kept.clientSecret, 'secreto');
  assert.equal(kept.refreshToken, 'token');
  assert.equal(kept.clientId, 'id2');
  await saveMailConfig(db, { refreshToken: 'nuevo' });
  assert.equal((await resolveMailConfig(db, {})).refreshToken, 'nuevo');
});

test('la vista pública nunca incluye el secreto ni el refresh token', async () => {
  const db = await makeDb();
  await saveMailConfig(db, { clientId: 'id', clientSecret: 'secreto', refreshToken: 'token', from: 'KanbanFlow' });
  const pub = await publicMailSettings(db, {});
  assert.deepEqual(pub, { clientId: 'id', from: 'KanbanFlow', hasClientSecret: true, hasRefreshToken: true });
  assert.ok(!JSON.stringify(pub).includes('secreto'));
  assert.ok(!JSON.stringify(pub).includes('token'));
});
