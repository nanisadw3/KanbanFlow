import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, mailerFromConfig, createGmailTransport, buildRawMessage, newTaskMessage, sharedTaskMessage, commentMessage, overdueMessage, testMessage } from './mailer.ts';

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

test('plantillas incluyen título, fecha y quién asignó', () => {
  const n = newTaskMessage(task, 'Roberto García');
  assert.match(n.subject, /Entregar reporte/);
  assert.match(n.text, /Roberto García/);
  assert.match(n.text, /martes 20 de octubre de 2026/);
  assert.match(n.html, /Roberto García/);
  const o = overdueMessage(task);
  assert.match(o.subject, /retrasad/i);
  assert.match(o.text, /Entregar reporte/);
});

test('el saludo usa el primer nombre del destinatario', () => {
  assert.match(newTaskMessage(task, 'Roberto', { name: 'Iñaki Sobera Sotomayor' }).text, /¡Hola, Iñaki! 👋/);
  assert.match(newTaskMessage(task, 'Roberto').text, /¡Hola! 👋/);
});

test('tarea nueva: cuenta regresiva según la fecha de hoy', () => {
  const at = (today: string) => newTaskMessage(task, 'R', { today }).text;
  assert.match(at('2026-10-20'), /Vence hoy/);
  assert.match(at('2026-10-19'), /Vence mañana/);
  assert.match(at('2026-10-15'), /Tienes 5 días/);
  assert.match(at('2026-10-25'), /ya pasó/);
  assert.ok(!/para completarla|Vence|ya pasó/.test(newTaskMessage(task, 'R').text));
});

test('tarea retrasada: dice cuántos días de retraso lleva', () => {
  assert.match(overdueMessage(task, { today: '2026-10-21' }).text, /venció ayer/);
  const m = overdueMessage(task, { today: '2026-10-25' });
  assert.match(m.text, /venció hace 5 días/);
  assert.match(m.html, /Retraso: 5 días/);
});

test('el HTML escapa lo que viene de datos de usuario', () => {
  const evil = { ...task, title: '<script>alert(1)</script>', description: 'a & <b>b</b>' };
  const { html } = newTaskMessage(evil, '<img src=x>', { name: '"><svg>' });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(!html.includes('<svg>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; &lt;b&gt;b&lt;\/b&gt;/);
});

test('el botón solo aparece con una URL http(s) válida', () => {
  assert.match(newTaskMessage(task, 'R', { appUrl: 'https://kanban.example.com' }).html, /Abrir KanbanFlow/);
  assert.ok(!newTaskMessage(task, 'R').html.includes('Abrir KanbanFlow'));
  assert.ok(!newTaskMessage(task, 'R', { appUrl: 'javascript:alert(1)' }).html.includes('Abrir KanbanFlow'));
});

test('el mensaje de prueba es amigable y trae HTML', () => {
  const t = testMessage({ name: 'Ana López' });
  assert.match(t.subject, /Prueba de KanbanFlow/);
  assert.match(t.html, /¡Hola, Ana! 👋/);
});

test('send pasa el html al transporte solo cuando existe', async () => {
  const sent: any[] = [];
  const mailer = createMailer({ sendMail: async o => { sent.push(o); } }, 'k@x.com');
  await mailer.send('a@x.com', 's', 't', '<p>hola</p>');
  assert.equal(sent[0].html, '<p>hola</p>');
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

test('buildRawMessage con html arma multipart/alternative con texto y HTML en UTF-8', () => {
  const mime = decodeRaw(buildRawMessage({ to: 'ana@x.com', subject: 's', text: 'Hola 👋 texto', html: '<p>Hola 👋 html</p>' }));
  assert.match(mime, /^Content-Type: multipart\/alternative; boundary="(kf_[0-9a-f]+)"$/m);
  const boundary = /boundary="([^"]+)"/.exec(mime)![1];
  const parts = mime.split(`--${boundary}`).slice(1, -1);
  assert.equal(parts.length, 2);
  const body = (p: string) => Buffer.from(p.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(parts[0], /text\/plain/);
  assert.equal(body(parts[0]), 'Hola 👋 texto');
  assert.match(parts[1], /text\/html/);
  assert.equal(body(parts[1]), '<p>Hola 👋 html</p>');
  assert.ok(mime.trimEnd().endsWith(`--${boundary}--`));
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

test('tarea compartida: lista a los participantes y distingue al administrador que solo recibe el aviso', () => {
  const p = sharedTaskMessage(task, 'Roberto', ['Ana', 'Beto'], { name: 'Ana P', today: '2026-10-15' });
  assert.match(p.subject, /Nueva tarea compartida: Entregar reporte/);
  assert.match(p.text, /formas parte del grupo: Ana, Beto/);
  assert.match(p.text, /5 días/);
  const admin = sharedTaskMessage(task, 'Roberto', ['Ana', 'Beto'], { participant: false });
  assert.match(admin.text, /eres administrador/);
  assert.ok(!/formas parte/.test(admin.text));
});

test('tarea compartida: el HTML escapa nombres y título', () => {
  const { html } = sharedTaskMessage({ ...task, title: '<b>x</b>' }, '<i>yo</i>', ['<u>Ana</u>']);
  assert.ok(!html.includes('<b>x</b>') && !html.includes('<i>yo</i>') && !html.includes('<u>Ana</u>'));
});

test('una tarea sin fecha de fin (repetitiva) no muestra fecha ni cuenta regresiva', () => {
  const m = newTaskMessage({ ...task, endDate: '' }, 'Roberto', { today: '2026-10-15' });
  assert.ok(!/Fecha de fin|Vence|días para|ya pasó/.test(m.text));
  assert.ok(!m.html.includes('📅'));
});

test('correo de comentario: cita el comentario, nombra a quien lo escribió y escapa el HTML', () => {
  const m = commentMessage(task, 'Beto Ruiz', 'Ya subí los datos.\nFalta la gráfica', { name: 'Ana Pérez' });
  assert.match(m.subject, /Beto Ruiz comentó en: Entregar reporte/);
  assert.match(m.text, /¡Hola, Ana! 👋/);
  assert.match(m.text, /“Ya subí los datos\.\nFalta la gráfica”/);
  assert.match(m.html, /Ya subí los datos\.<br>Falta la gráfica/);
  const evil = commentMessage({ ...task, title: '<b>t</b>' }, '<i>x</i>', '<script>alert(1)</script>');
  assert.ok(!evil.html.includes('<script>') && !evil.html.includes('<i>x</i>') && !evil.html.includes('<b>t</b>'));
  assert.match(evil.html, /&lt;script&gt;/);
});

test('correo de comentario: recorta los comentarios muy largos', () => {
  const m = commentMessage(task, 'Beto', 'a'.repeat(1000));
  assert.ok(m.text.length < 900);
  assert.match(m.text, /…/);
});

// ── Colors and wording that follow the kind of task (same colors as the app) ──────────────────

const COLORS = { shared: '#6a3db8', recurring: '#0e6663', assigned: '#a8185f', routine: '#4f6400', overdue: '#dc2626' };

test('tarea asignada por alguien: rosa como en la app, lo dice y avisa la prioridad', () => {
  const m = newTaskMessage(task, 'Roberto', { name: 'Ana P', today: '2026-10-15' });
  assert.ok(m.html.includes(COLORS.assigned));
  assert.match(m.text, /Tarea asignada/);
  assert.match(m.text, /Asignada por Roberto/);
  assert.match(m.text, /prioridad alta: conviene empezar pronto/);
  assert.match(newTaskMessage({ ...task, priority: 'baja' }, 'R').text, /sin prisa/);
  assert.ok(!/prioridad (alta|baja)/.test(newTaskMessage({ ...task, priority: 'media' }, 'R').text.replace(/Prioridad: \S+/g, '')));
});

test('tarea repetitiva asignada: verde azulado, dice cada cuánto y que no lleva fecha de fin', () => {
  const m = newTaskMessage({ ...task, endDate: '' }, 'Roberto', { name: 'Ana P', repeatLabel: 'Cada semana, los lunes' });
  assert.ok(m.html.includes(COLORS.recurring) && !m.html.includes(COLORS.assigned));
  assert.match(m.subject, /repetitiva/i);
  assert.match(m.text, /Cada semana, los lunes/);
  assert.match(m.text, /No lleva fecha de fin/);
  assert.ok(!m.text.includes('Fecha de fin'));
});

test('tarea compartida: violeta; si te agregaron después lo dice; el admin sigue distinguiéndose', () => {
  const created = sharedTaskMessage(task, 'Roberto', ['Ana', 'Beto'], { name: 'Ana P' });
  assert.ok(created.html.includes(COLORS.shared));
  assert.match(created.text, /creó una tarea compartida y tú formas parte/);
  const added = sharedTaskMessage(task, 'Roberto', ['Ana', 'Beto'], { name: 'Ana P', added: true });
  assert.match(added.subject, /Te agregaron a una tarea compartida/);
  assert.match(added.text, /te agregó a una tarea compartida que ya estaba en marcha/);
  assert.match(sharedTaskMessage(task, 'Roberto', ['Ana'], { participant: false }).text, /eres administrador/);
});

test('rutina (compartida y repetitiva): lima, con su nombre, la frecuencia y cómo funciona cada ciclo', () => {
  const m = sharedTaskMessage({ ...task, endDate: '' }, 'Roberto', ['Ana', 'Beto'], { name: 'Ana P', repeatLabel: 'Cada mes, el día 15' });
  assert.ok(m.html.includes(COLORS.routine) && !m.html.includes(COLORS.shared));
  assert.match(m.subject, /Nueva rutina de equipo/);
  assert.match(m.text, /rutina: una tarea compartida que se repite sola/);
  assert.match(m.text, /Cada mes, el día 15/);
  assert.match(m.text, /al 0% y con los comentarios en blanco/);
  assert.match(sharedTaskMessage(task, 'R', ['Ana'], { repeatLabel: 'x', added: true }).subject, /Te agregaron a una rutina/);
  assert.match(sharedTaskMessage(task, 'R', ['Ana'], { repeatLabel: 'x', participant: false }).text, /eres administrador/);
});

test('comentario: en una rutina usa lima y lo dice; en una tarea compartida normal queda como antes', () => {
  const normal = commentMessage(task, 'Beto', 'hola');
  assert.equal(normal.subject, '💬 Beto comentó en: Entregar reporte');
  assert.ok(normal.html.includes(COLORS.shared));
  const routine = commentMessage(task, 'Beto', 'hola', { routine: true });
  assert.equal(routine.subject, '💬 Beto comentó en la rutina: Entregar reporte');
  assert.ok(routine.html.includes(COLORS.routine));
  assert.match(routine.text, /Nuevo comentario en tu rutina/);
});

test('retraso: sigue en rojo pero cambia el texto si fue asignada o si es compartida', () => {
  const base = overdueMessage(task, { today: '2026-10-25' });
  assert.ok(base.html.includes(COLORS.overdue));
  assert.match(base.text, /una de tus tareas/);
  const assigned = overdueMessage(task, { today: '2026-10-25', assignedByName: 'Roberto' });
  assert.ok(assigned.html.includes(COLORS.overdue));
  assert.match(assigned.text, /La tarea que te asignó Roberto venció hace 5 días/);
  assert.match(assigned.text, /avísale a Roberto/);
  const shared = overdueMessage(task, { today: '2026-10-25', shared: true, people: 3 });
  assert.match(shared.text, /tarea compartida en la que participas \(con 3 personas\)/);
  assert.match(shared.text, /Tu avance suma al del equipo/);
  assert.match(base.text, /prioridad alta, así que conviene ponerla al día/);
  assert.ok(!/Era de prioridad alta/.test(overdueMessage({ ...task, priority: 'media' }, { today: '2026-10-25' }).text));
});

test('los textos nuevos también escapan el HTML', () => {
  const evil = '<script>alert(1)</script>';
  for (const html of [
    newTaskMessage(task, evil, { repeatLabel: evil }).html,
    newTaskMessage(task, evil).html,
    sharedTaskMessage(task, evil, [evil], { repeatLabel: evil, added: true }).html,
    commentMessage(task, evil, evil, { routine: true }).html,
    overdueMessage(task, { assignedByName: evil, today: '2026-10-25' }).html,
  ]) assert.ok(!html.includes(evil));
});
