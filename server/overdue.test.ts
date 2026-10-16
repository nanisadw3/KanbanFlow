import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { localToday, runOverdueCheck, createOverdueChecker, msUntilNextLocalMidnight } from './overdue.ts';
import { createMailer } from './mailer.ts';

async function makeDb(): Promise<Database> {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (username TEXT PRIMARY KEY, fullName TEXT, role TEXT, lastLogin TEXT, email TEXT);
    CREATE TABLE activities (id TEXT PRIMARY KEY, title TEXT, description TEXT, startDate TEXT, endDate TEXT,
      status TEXT, username TEXT, createdAt TEXT, assignedBy TEXT, priority TEXT, progress INTEGER,
      teamId TEXT, completedAt TEXT, archived INTEGER DEFAULT 0, overdueNotifiedAt TEXT);
    INSERT INTO users VALUES ('Ana','Ana P','user','x','ana@x.com'), ('Sin','Sin Correo','user','x',NULL);
  `);
  return db;
}
const addAct = (db: Database, id: string, endDate: string, status: string, username = 'Ana') =>
  db.run(`INSERT INTO activities (id,title,description,startDate,endDate,status,username,createdAt,priority)
          VALUES (?,?,?,?,?,?,?,?,?)`, [id, 'T' + id, '', '2026-10-01', endDate, status, username, 'x', 'media']);
const okMailer = () => {
  const sent: any[] = [];
  return { sent, mailer: createMailer({ sendMail: async o => { sent.push(o); } }, 'k@x.com') };
};
const stamp = async (db: Database, id: string) =>
  (await db.get(`SELECT overdueNotifiedAt v FROM activities WHERE id='${id}'`)).v;

test('localToday formatea YYYY-MM-DD en hora local', () => {
  assert.equal(localToday(new Date(2026, 9, 5, 23, 59)), '2026-10-05');
});

test('avisa una sola vez y marca la tarea', async () => {
  const db = await makeDb(); const { sent, mailer } = okMailer();
  await addAct(db, '1', '2026-10-10', 'todo');
  assert.equal(await runOverdueCheck(db, mailer, '2026-10-16'), 1);
  assert.equal(await runOverdueCheck(db, mailer, '2026-10-16'), 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ana@x.com');
  assert.ok(await stamp(db, '1'));
});

test('no avisa el mismo día del vencimiento ni tareas terminadas/canceladas', async () => {
  const db = await makeDb(); const { sent, mailer } = okMailer();
  await addAct(db, '1', '2026-10-16', 'todo');
  await addAct(db, '2', '2026-10-01', 'done');
  await addAct(db, '3', '2026-10-01', 'cancelled');
  assert.equal(await runOverdueCheck(db, mailer, '2026-10-16'), 0);
  assert.equal(sent.length, 0);
});

test('usuario sin correo: no marca; avisa cuando ya tiene correo', async () => {
  const db = await makeDb(); const { sent, mailer } = okMailer();
  await addAct(db, '1', '2026-10-01', 'doing', 'Sin');
  assert.equal(await runOverdueCheck(db, mailer, '2026-10-16'), 0);
  assert.equal(await stamp(db, '1'), null);
  await db.run("UPDATE users SET email='sin@x.com' WHERE username='Sin'");
  assert.equal(await runOverdueCheck(db, mailer, '2026-10-16'), 1);
  assert.equal(sent[0].to, 'sin@x.com');
});

test('fallo SMTP: no marca y reintenta después', async () => {
  const db = await makeDb();
  await addAct(db, '1', '2026-10-01', 'todo');
  const bad = createMailer({ sendMail: async () => { throw new Error('down'); } }, 'k@x.com');
  assert.equal(await runOverdueCheck(db, bad, '2026-10-16'), 0);
  assert.equal(await stamp(db, '1'), null);
  const { sent, mailer } = okMailer();
  assert.equal(await runOverdueCheck(db, mailer, '2026-10-16'), 1);
  assert.equal(sent.length, 1);
});

test('mailer deshabilitado no marca nada', async () => {
  const db = await makeDb();
  await addAct(db, '1', '2026-10-01', 'todo');
  assert.equal(await runOverdueCheck(db, createMailer(null, ''), '2026-10-16'), 0);
  assert.equal(await stamp(db, '1'), null);
});

test('pasadas solapadas no duplican el aviso (guard en vuelo)', async () => {
  const db = await makeDb();
  await addAct(db, '1', '2026-10-01', 'todo');
  const sent: any[] = [];
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const slow = createMailer({ sendMail: async o => { await gate; sent.push(o); } }, 'k@x.com');
  const check = createOverdueChecker(db, slow, () => '2026-10-16');
  const first = check();
  const second = await check(); // arranca mientras la primera sigue enviando
  assert.equal(second, 0);
  release();
  assert.equal(await first, 1);
  assert.equal(sent.length, 1);
});

test('el revisor usa el mailer vigente en cada pasada (config cambiada desde el panel)', async () => {
  const db = await makeDb();
  await addAct(db, '1', '2026-10-01', 'todo');
  let current = createMailer(null, '');
  const check = createOverdueChecker(db, () => current, () => '2026-10-16');
  assert.equal(await check(), 0);
  const { sent, mailer } = okMailer();
  current = mailer;
  assert.equal(await check(), 1);
  assert.equal(sent.length, 1);
});

test('una tarea archivada no genera aviso de retraso', async () => {
  const db = await makeDb(); const { sent, mailer } = okMailer();
  await addAct(db, '1', '2026-10-01', 'todo');
  await db.run("UPDATE activities SET archived = 1 WHERE id = '1'");
  assert.equal(await runOverdueCheck(db, mailer, '2026-10-16'), 0);
  assert.equal(sent.length, 0);
  await db.run("UPDATE activities SET archived = 0 WHERE id = '1'"); // restaurada: ahora sí
  assert.equal(await runOverdueCheck(db, mailer, '2026-10-16'), 1);
});

test('una tarea que llega mientras corre una pasada se avisa en una repetición inmediata', async () => {
  const db = await makeDb();
  await addAct(db, '1', '2026-10-01', 'todo');
  const sent: any[] = [];
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const slow = createMailer({ sendMail: async o => { await gate; sent.push(o); } }, 'k@x.com');
  const check = createOverdueChecker(db, slow, () => '2026-10-16');
  const first = check();                       // enviando la tarea 1
  await addAct(db, '2', '2026-10-02', 'doing'); // llega otra vencida durante la pasada
  assert.equal(await check(), 0);              // se solapa: no lanza otra pasada, pide repetir
  release();
  assert.equal(await first, 2);                // la repetición avisó la tarea 2 sin esperar al reloj
  assert.equal(sent.length, 2);
});

test('msUntilNextLocalMidnight cuenta hasta la próxima medianoche local', () => {
  assert.equal(msUntilNextLocalMidnight(new Date(2026, 9, 16, 23, 59, 30)), 30_000);
  assert.equal(msUntilNextLocalMidnight(new Date(2026, 9, 16, 12, 0, 0)), 12 * 3600_000);
});
