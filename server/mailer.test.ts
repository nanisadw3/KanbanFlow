import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, mailerFromEnv, mailerFromConfig, createGmailTransport, buildRawMessage, newTaskMessage, overdueMessage } from './mailer.ts';

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

test('mailerFromEnv queda deshabilitado sin variables GMAIL_*', () => {
  assert.equal(mailerFromEnv({}).enabled, false);
  assert.equal(mailerFromEnv({ GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r' }).enabled, true);
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

test('trySend devuelve el motivo del fallo', async () => {
  const bad = createMailer({ sendMail: async () => { throw new Error('535 bad credentials'); } }, 'k@x.com');
  assert.deepEqual(await bad.trySend('a@x.com', 's', 't'), { ok: false, error: '535 bad credentials' });
  const good = createMailer({ sendMail: async () => {} }, 'k@x.com');
  assert.deepEqual(await good.trySend('a@x.com', 's', 't'), { ok: true });
  assert.equal((await createMailer(null, '').trySend('a@x.com', 's', 't')).ok, false);
});

test('mailerFromConfig exige Client ID, Client Secret y Refresh token', () => {
  assert.equal(mailerFromConfig({ clientId: 'id', clientSecret: 's', refreshToken: 'r' }).enabled, true);
  assert.equal(mailerFromConfig({ clientId: 'id', clientSecret: 's' }).enabled, false);
  assert.equal(mailerFromConfig({}).enabled, false);
});

const decodeRaw = (raw: string) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const creds = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('buildRawMessage codifica asunto y cuerpo en UTF-8 y arma las cabeceras', () => {
  const mime = decodeRaw(buildRawMessage({ from: 'KanbanFlow <k@x.com>', to: 'ana@x.com', subject: 'Reunión ñandú', text: 'Acción: revisar' }));
  const [head, body] = mime.split('\r\n\r\n');
  assert.match(head, /^From: KanbanFlow <k@x.com>$/m);
  assert.match(head, /^To: ana@x.com$/m);
  const subject = /^Subject: =\?UTF-8\?B\?(.+)\?=$/m.exec(head)![1];
  assert.equal(Buffer.from(subject, 'base64').toString('utf8'), 'Reunión ñandú');
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Acción: revisar');
});

test('buildRawMessage omite From si no hay remitente y no deja inyectar cabeceras', () => {
  const mime = decodeRaw(buildRawMessage({ to: 'ana@x.com\r\nBcc: robo@x.com', subject: 's', text: 't' }));
  assert.ok(!/^From:/m.test(mime));
  assert.ok(!/^Bcc:/m.test(mime));
});

test('el transporte pide un access token y envía por la Gmail API', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return url.includes('oauth2') ? json({ access_token: 'tok', expires_in: 3600 }) : json({ id: 'm1' });
  }) as unknown as typeof fetch;
  const transport = createGmailTransport(creds, fetchFn);
  await transport.sendMail({ to: 'ana@x.com', subject: 'Hola', text: 'Cuerpo' });
  assert.equal(calls.length, 2);
  const form = new URLSearchParams(String(calls[0].init.body));
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), 'refresh');
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, 'Bearer tok');
  assert.match(decodeRaw(JSON.parse(String(calls[1].init.body)).raw), /^To: ana@x.com$/m);
});

test('el access token se reutiliza entre envíos', async () => {
  let tokenRequests = 0;
  const fetchFn = (async (url: string) => {
    if (url.includes('oauth2')) { tokenRequests++; return json({ access_token: 'tok', expires_in: 3600 }); }
    return json({ id: 'm' });
  }) as unknown as typeof fetch;
  const transport = createGmailTransport(creds, fetchFn);
  await transport.sendMail({ to: 'a@x.com', subject: 's', text: 't' });
  await transport.sendMail({ to: 'b@x.com', subject: 's', text: 't' });
  assert.equal(tokenRequests, 1);
});

test('un refresh token revocado se reporta con el motivo de Google', async () => {
  const fetchFn = (async () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400)) as unknown as typeof fetch;
  const mailer = mailerFromConfig(creds, fetchFn);
  const result = await mailer.trySend('a@x.com', 's', 't');
  assert.equal(result.ok, false);
  assert.match(result.error!, /expired or revoked/);
});

test('un rechazo de Gmail al enviar se reporta y el 401 descarta el token', async () => {
  let tokenRequests = 0;
  let sends = 0;
  const fetchFn = (async (url: string) => {
    if (url.includes('oauth2')) { tokenRequests++; return json({ access_token: 'tok' + tokenRequests, expires_in: 3600 }); }
    sends++;
    return sends === 1 ? json({ error: { message: 'Invalid Credentials' } }, 401) : json({ id: 'm' });
  }) as unknown as typeof fetch;
  const transport = createGmailTransport(creds, fetchFn);
  await assert.rejects(transport.sendMail({ to: 'a@x.com', subject: 's', text: 't' }), /Invalid Credentials/);
  await transport.sendMail({ to: 'a@x.com', subject: 's', text: 't' });
  assert.equal(tokenRequests, 2);
});
