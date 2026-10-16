import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, mailerFromEnv, newTaskMessage, overdueMessage } from './mailer.ts';

const task = { title: 'Entregar reporte', description: 'Reporte mensual', endDate: '2026-10-20', priority: 'alta' };

test('send entrega el mensaje al transporte', async () => {
  const sent: any[] = [];
  const mailer = createMailer({ sendMail: async o => { sent.push(o); } }, 'KanbanFlow <k@x.com>');
  assert.equal(await mailer.send('ana@x.com', 'Hola', 'Cuerpo'), true);
  assert.deepEqual(sent[0], { from: 'KanbanFlow <k@x.com>', to: 'ana@x.com', subject: 'Hola', text: 'Cuerpo' });
});

test('send devuelve false (sin lanzar) si el transporte falla', async () => {
  const mailer = createMailer({ sendMail: async () => { throw new Error('smtp down'); } }, 'k@x.com');
  assert.equal(await mailer.send('ana@x.com', 's', 't'), false);
});

test('mailer deshabilitado no envía', async () => {
  const mailer = createMailer(null, 'k@x.com');
  assert.equal(mailer.enabled, false);
  assert.equal(await mailer.send('ana@x.com', 's', 't'), false);
});

test('mailerFromEnv queda deshabilitado sin variables SMTP', () => {
  assert.equal(mailerFromEnv({}).enabled, false);
  assert.equal(mailerFromEnv({ SMTP_HOST: 'smtp.x.com', SMTP_USER: 'u', SMTP_PASS: 'p' }).enabled, true);
});

test('plantillas incluyen título, fecha y quién asignó', () => {
  const n = newTaskMessage(task, 'Roberto García');
  assert.match(n.subject, /Entregar reporte/);
  assert.match(n.text, /Roberto García/);
  assert.match(n.text, /2026-10-20/);
  const o = overdueMessage(task);
  assert.match(o.subject, /retrasad/i);
  assert.match(o.text, /Entregar reporte/);
});
