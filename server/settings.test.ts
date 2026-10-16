import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { ensureSettingsTable, resolveSmtpConfig, saveSmtpSettings, publicSmtpSettings } from './settings.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await ensureSettingsTable(db);
  return db;
}

test('sin datos en la base, usa las variables de entorno', async () => {
  const db = await makeDb();
  const cfg = await resolveSmtpConfig(db, { SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'f' });
  assert.deepEqual(cfg, { host: 'h', port: 465, user: 'u', pass: 'p', from: 'f' });
});

test('lo guardado en la base tiene prioridad campo por campo', async () => {
  const db = await makeDb();
  await saveSmtpSettings(db, { host: 'smtp.gmail.com', user: 'g@gmail.com' });
  const cfg = await resolveSmtpConfig(db, { SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'envpass' });
  assert.equal(cfg.host, 'smtp.gmail.com');
  assert.equal(cfg.user, 'g@gmail.com');
  assert.equal(cfg.pass, 'envpass');
});

test('contraseña vacía al guardar conserva la actual; una nueva la reemplaza', async () => {
  const db = await makeDb();
  await saveSmtpSettings(db, { host: 'h', user: 'u', pass: 'secreta' });
  await saveSmtpSettings(db, { host: 'h2', pass: '' });
  assert.equal((await resolveSmtpConfig(db, {})).pass, 'secreta');
  assert.equal((await resolveSmtpConfig(db, {})).host, 'h2');
  await saveSmtpSettings(db, { pass: 'nueva' });
  assert.equal((await resolveSmtpConfig(db, {})).pass, 'nueva');
});

test('la vista pública nunca incluye la contraseña', async () => {
  const db = await makeDb();
  await saveSmtpSettings(db, { host: 'h', user: 'u', pass: 'secreta', from: 'KanbanFlow <a@b.com>', port: 587 });
  const pub = await publicSmtpSettings(db, {});
  assert.deepEqual(pub, { host: 'h', port: 587, user: 'u', from: 'KanbanFlow <a@b.com>', hasPassword: true });
  assert.ok(!JSON.stringify(pub).includes('secreta'));
});
