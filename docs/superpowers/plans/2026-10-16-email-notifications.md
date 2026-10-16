# Notificaciones por correo y tareas retrasadas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada usuario tiene un correo obligatorio; el servidor avisa por correo cuando un admin le crea una tarea y una sola vez cuando una tarea suya se retrasa; las tarjetas retrasadas se ven en rojo.

**Architecture:** Dos columnas nuevas (`users.email`, `activities.overdueNotifiedAt`) agregadas con `ALTER TABLE` al arrancar. Lógica nueva y testeable en módulos pequeños del servidor (`email.ts`, `mailer.ts`, `overdue.ts`) con dependencias inyectadas; `server/index.ts` solo las conecta. El cliente añade campo/diálogo de correo y una clase CSS `overdue` calculada en el navegador.

**Tech Stack:** Node + Express + socket.io + SQLite (`sqlite`/`sqlite3`), `nodemailer` (nuevo), `node:test` vía `tsx` para pruebas del servidor, React 19 + Vite, Playwright para verificación visual.

**Spec:** `docs/superpowers/specs/2026-10-16-email-notifications-design.md`

## Global Constraints

- Variables de entorno SMTP exactas: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. Nunca en la base ni en git.
- Si faltan variables, el mailer queda deshabilitado (no-op, aviso único en consola); el servidor sigue funcionando.
- Un fallo de envío nunca bloquea crear una tarea ni el revisor.
- Aviso de tarea nueva: solo al **crear**, solo si `assignedBy` es un admin, y el destinatario es otro usuario con correo.
- Aviso de retraso: una sola vez por tarea (`overdueNotifiedAt`); retrasada = `endDate < hoy` (local, `YYYY-MM-DD`) y `status` no es `done` ni `cancelled`; revisor cada 5 min y al arrancar.
- Reiniciar `overdueNotifiedAt` a `NULL` cuando cambia `endDate` o la tarea sale de `done`/`cancelled`.
- Migraciones solo con `ALTER TABLE ... ADD COLUMN` (patrón existente, dentro de `try/catch`) para no tocar datos de otras computadoras.
- Textos de UI y correos en español.
- Colores solo con tokens CSS (`--color-danger`, `--color-danger-rgb` ya existen en ambos temas); nada de hex/rgb crudos en `App.css`.
- Opcionales hacia Firestore-style: nada de `undefined` en SQLite; usar `null`.
- `App.tsx` no se divide en componentes; cambios mínimos in situ.
- Mantener `isDraggingRef`/trash-zone intactos; no tocar el código de drag-and-drop.

## Review Focus

- Correo con espacios o mayúsculas (`" Ana@Mail.com "`) → se recorta y se acepta; guardarlo recortado.
- Admin se asigna una tarea a sí mismo → no recibe correo de "tarea nueva".
- Tarea creada con `endDate` ya pasado → recibe el correo de nueva y, en la siguiente vuelta, el de retraso (aceptado; ambos se envían una vez).
- Usuario asignado sin correo cuando vence la tarea → no se marca; al registrar su correo, el siguiente ciclo avisa.
- Servidor reiniciado con tareas ya notificadas → no se repite ningún aviso.
- Falla SMTP al enviar el retraso → no se marca y se reintenta en el siguiente ciclo.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `server/email.ts` (nuevo) | `normalizeEmail`, `isValidEmail` |
| `server/mailer.ts` (nuevo) | Transporte nodemailer, `Mailer`, plantillas de los dos correos |
| `server/overdue.ts` (nuevo) | `localToday`, `runOverdueCheck` |
| `server/*.test.ts` (nuevos) | Pruebas `node:test` de los tres módulos |
| `server/index.ts` | Migraciones, handlers de usuario/actividad, intervalo |
| `src/db.ts` | Tipos y funciones cliente (`email`, `setUserEmail`, `overdueNotifiedAt`) |
| `src/App.tsx` | Campos de correo, diálogo obligatorio, `isOverdue`, clase/etiqueta |
| `src/App.css` | Estilos `.overdue`, `.overdue-badge` |
| `README.md`, `CLAUDE.md`, `Dockerfile` | Documentación y variables de entorno |

---

### Task 1: Validación de correo y columna `users.email`

**Files:**
- Create: `server/email.ts`, `server/email.test.ts`
- Modify: `package.json` (script `test:server`), `server/index.ts` (interface `User` ~l.28, migración ~l.141, `getUsers` ~l.221, `user:login` ~l.391, `user:create` ~l.410, nuevo `user:setEmail`)

**Interfaces:**
- Produces: `normalizeEmail(raw: unknown): string | null` (recorta; `null` si no es un correo válido), `isValidEmail(raw: unknown): boolean`.
- Produces (socket): `user:setEmail` con payload `{ username: string; email: string }` y ack opcional `{ ok: boolean; error?: 'invalid_email' | 'not_found' }`. `user:create` y `user:login` aceptan `email?: string`.

- [ ] **Step 1: Escribir la prueba que falla**

`server/email.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, isValidEmail } from './email.ts';

test('normalizeEmail recorta espacios y acepta correos válidos', () => {
  assert.equal(normalizeEmail('  Ana@Mail.com '), 'Ana@Mail.com');
  assert.equal(normalizeEmail('a.b+c@sub.dominio.mx'), 'a.b+c@sub.dominio.mx');
});

test('normalizeEmail rechaza valores inválidos', () => {
  for (const bad of ['', '   ', 'sinarroba', 'a@b', '@x.com', 'a@ x.com', 'a b@x.com', null, undefined, 42]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
});

test('isValidEmail refleja normalizeEmail', () => {
  assert.equal(isValidEmail('ok@x.com'), true);
  assert.equal(isValidEmail('nope'), false);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Agregar a `package.json` en `scripts`: `"test:server": "node --import tsx --test server/*.test.ts"`.

Run: `npm run test:server`
Expected: FAIL (`Cannot find module './email.ts'`).

- [ ] **Step 3: Implementar `server/email.ts`**

```ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim();
  return EMAIL_RE.test(email) ? email : null;
}

export const isValidEmail = (raw: unknown): boolean => normalizeEmail(raw) !== null;
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test:server`
Expected: PASS (3 tests).

- [ ] **Step 5: Columna y handlers en `server/index.ts`**

Importar arriba: `import { normalizeEmail } from './email.ts';`

Interface `User` (servidor): agregar `email?: string | null;`.

Después de la migración de `passwordHash` (~l.145) agregar:

```ts
  try {
    await db.exec("ALTER TABLE users ADD COLUMN email TEXT;");
  } catch {
    // Column might already exist
  }
```

`getUsers`:

```ts
  return await db.all<User[]>('SELECT username, fullName, role, lastLogin, email FROM users');
```

`user:login`: ampliar el payload y la inserción:

```ts
  socket.on('user:login', async (payload: { username: string; fullName?: string; email?: string } | string) => {
    const username = await canonicalUsername(typeof payload === 'string' ? payload : payload.username);
    const fullName = typeof payload === 'string' ? undefined : payload.fullName;
    const email = typeof payload === 'string' ? null : normalizeEmail(payload.email);
    const role = username.toLowerCase() === 'admin' ? 'admin' : 'user';
    const lastLogin = new Date().toISOString();

    await db.run(
      `INSERT INTO users (username, fullName, role, lastLogin, email) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET
         fullName = COALESCE(excluded.fullName, users.fullName),
         email = COALESCE(users.email, excluded.email),
         lastLogin = excluded.lastLogin`,
      [username, fullName || null, role, lastLogin, email]
    );
    await ensureAdminPasswords();
    await broadcastUsers();
  });
```

`user:create`: ampliar el payload con `email: string`, rechazar si no es válido (igual que ya rechaza admin sin contraseña) e incluirlo:

```ts
  socket.on('user:create', async (payload: { username: string; fullName: string; role: 'admin' | 'user'; password?: string; email?: string }) => {
    const { fullName } = payload;
    const email = normalizeEmail(payload.email);
    if (!email) return;
    const role = payload.role === 'admin' ? 'admin' : 'user';
    const username = await canonicalUsername(payload.username);
    const lastLogin = new Date().toISOString();
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (role === 'admin' && password.length < MIN_PASSWORD_LENGTH) return;
    const passwordHash = role === 'admin' ? await hashPassword(password) : null;
    await db.run(
      `INSERT INTO users (username, fullName, role, lastLogin, passwordHash, email) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET fullName = excluded.fullName, role = excluded.role, email = excluded.email,
         passwordHash = COALESCE(excluded.passwordHash, users.passwordHash)`,
      [username, fullName, role, lastLogin, passwordHash, email]
    );
    await ensureAdminPasswords();
    await broadcastUsers();
  });
```

Nuevo handler, justo después de `user:create`:

```ts
  socket.on('user:setEmail', async (
    payload: { username?: string; email?: string },
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => {
    const reply = ack ?? (() => {});
    const email = normalizeEmail(payload?.email);
    if (!email) return reply({ ok: false, error: 'invalid_email' });
    const username = typeof payload?.username === 'string' ? payload.username : '';
    const result = await db.run('UPDATE users SET email = ? WHERE username = ? COLLATE NOCASE', [email, username]);
    if (!result.changes) return reply({ ok: false, error: 'not_found' });
    await broadcastUsers();
    reply({ ok: true });
  });
```

- [ ] **Step 6: Verificar migración sobre una copia de la base**

Run:
```bash
cp kanban.db /tmp/kanban-copy.db && DB_PATH=/tmp/kanban-copy.db PORT=3055 npx tsx server/index.ts & sleep 3; kill %1
sqlite3 /tmp/kanban-copy.db "pragma table_info(users);" "select count(*) from users; select count(*) from activities;"
```
Expected: aparece la columna `email`; 8 usuarios y 9 actividades intactos. (Usar `/private/tmp/claude-501/-Users-inakisobera-Documents-Kanban/8a675d0a-ee71-4257-b5ba-5468220ae15a/scratchpad/` en lugar de `/tmp`.)

- [ ] **Step 7: Commit**

```bash
git add server/email.ts server/email.test.ts server/index.ts package.json
git commit -m "feat: add required email column and user:setEmail handler"
```

---

### Task 2: Módulo de envío de correo

**Files:**
- Create: `server/mailer.ts`, `server/mailer.test.ts`
- Modify: `package.json` / lockfile (`npm install nodemailer` + `npm install -D @types/nodemailer`)

**Interfaces:**
- Produces:
  - `interface MailTask { title: string; description: string; endDate: string; priority: string }`
  - `interface Mailer { enabled: boolean; send(to: string, subject: string, text: string): Promise<boolean> }`
  - `createMailer(transport: { sendMail(opts: any): Promise<unknown> } | null, from: string): Mailer`
  - `mailerFromEnv(env = process.env): Mailer`
  - `newTaskMessage(task: MailTask, assignedByName: string): { subject: string; text: string }`
  - `overdueMessage(task: MailTask): { subject: string; text: string }`
- `send` devuelve `true` si se envió, `false` si está deshabilitado o falló (nunca lanza).

- [ ] **Step 1: Instalar dependencias**

Run: `npm install nodemailer && npm install -D @types/nodemailer`

- [ ] **Step 2: Escribir las pruebas que fallan**

`server/mailer.test.ts`:

```ts
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
```

- [ ] **Step 3: Ejecutar y ver que falla**

Run: `npm run test:server`
Expected: FAIL (`Cannot find module './mailer.ts'`).

- [ ] **Step 4: Implementar `server/mailer.ts`**

```ts
import nodemailer from 'nodemailer';

export interface MailTask {
  title: string;
  description: string;
  endDate: string;
  priority: string;
}

export interface Mailer {
  enabled: boolean;
  send(to: string, subject: string, text: string): Promise<boolean>;
}

type Transport = { sendMail(opts: any): Promise<unknown> };

export function createMailer(transport: Transport | null, from: string): Mailer {
  return {
    enabled: transport !== null,
    async send(to, subject, text) {
      if (!transport) return false;
      try {
        await transport.sendMail({ from, to, subject, text });
        return true;
      } catch (err) {
        console.error('[Mailer] No se pudo enviar el correo a', to, err);
        return false;
      }
    },
  };
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('[Mailer] SMTP_HOST/SMTP_USER/SMTP_PASS no configurados: los correos están deshabilitados.');
    return createMailer(null, '');
  }
  const port = Number(SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return createMailer(transport, MAIL_FROM || `KanbanFlow <${SMTP_USER}>`);
}

export function newTaskMessage(task: MailTask, assignedByName: string) {
  return {
    subject: `Nueva tarea asignada: ${task.title}`,
    text:
      `${assignedByName} te asignó una nueva tarea en KanbanFlow.\n\n` +
      `Tarea: ${task.title}\n` +
      `Descripción: ${task.description || 'Sin descripción.'}\n` +
      `Prioridad: ${task.priority}\n` +
      `Fecha de fin: ${task.endDate}\n`,
  };
}

export function overdueMessage(task: MailTask) {
  return {
    subject: `Tarea retrasada: ${task.title}`,
    text:
      `Tu tarea "${task.title}" está retrasada.\n\n` +
      `Descripción: ${task.description || 'Sin descripción.'}\n` +
      `Prioridad: ${task.priority}\n` +
      `Debía terminar el: ${task.endDate}\n\n` +
      `Entra a KanbanFlow para actualizarla.\n`,
  };
}
```

- [ ] **Step 5: Ejecutar y ver que pasa**

Run: `npm run test:server`
Expected: PASS (email + mailer).

- [ ] **Step 6: Commit**

```bash
git add server/mailer.ts server/mailer.test.ts package.json package-lock.json
git commit -m "feat: add nodemailer-based mailer with new-task and overdue templates"
```

---

### Task 3: Aviso de tarea nueva

**Files:**
- Modify: `server/index.ts` (import, `const mailer`, handler `activity:add` ~l.262)

**Interfaces:**
- Consumes: `mailerFromEnv`, `newTaskMessage` (Task 2); `isAdminRow` ya existe en `server/index.ts`.
- Produces: `const mailer: Mailer` a nivel de módulo en `server/index.ts` (la usa Task 4).

- [ ] **Step 1: Importar y crear el mailer**

Arriba, junto a los demás imports:

```ts
import { mailerFromEnv, newTaskMessage, overdueMessage, type Mailer } from './mailer.ts';
```

Después de `const DB_PATH = ...`:

```ts
const mailer: Mailer = mailerFromEnv();
```

- [ ] **Step 2: Helper de notificación**

Antes de `io.on('connection', ...)`:

```ts
// Fire-and-forget: a mail problem must never block or fail the task creation.
async function notifyNewTask(task: Activity) {
  if (!mailer.enabled || !task.assignedBy) return;
  const assigner = await db.get<{ username: string; fullName: string | null; role: string | null }>(
    'SELECT username, fullName, role FROM users WHERE username = ? COLLATE NOCASE', [task.assignedBy]
  );
  if (!assigner || !isAdminRow(assigner)) return;
  if (assigner.username.toLowerCase() === task.username.toLowerCase()) return;
  const assignee = await db.get<{ email: string | null }>(
    'SELECT email FROM users WHERE username = ? COLLATE NOCASE', [task.username]
  );
  if (!assignee?.email) return;
  const { subject, text } = newTaskMessage(task, assigner.fullName || assigner.username);
  await mailer.send(assignee.email, subject, text);
}
```

- [ ] **Step 3: Llamarlo desde `activity:add`**

Justo antes de `await broadcastActivities();` en `activity:add`:

```ts
    void notifyNewTask({ ...activityData, id, createdAt });
```

- [ ] **Step 4: Verificar con un transporte falso**

Crear `scratchpad/smtp-sink.ts` (en el directorio scratchpad, no en el repo) que levante un SMTP local con `nodemailer`'s `smtp-server` NO es necesario: basta con comprobar vía script que `notifyNewTask` llama a `mailer.send`. Alternativa simple: arrancar el servidor con `SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_USER=u SMTP_PASS=p` y un sumidero `node -e "require('net').createServer(s=>{s.write('220 ok\r\n');s.on('data',d=>{process.stdout.write(d);const t=d.toString();if(/^DATA/i.test(t))s.write('354 go\r\n');else if(/\r\n\.\r\n$/.test(t))s.write('250 ok\r\n');else if(/^QUIT/i.test(t)){s.write('221 bye\r\n');s.end()}else s.write('250 ok\r\n')})}).listen(2525)"`, crear una tarea como admin desde la UI (o con un cliente socket.io de una línea) y ver el `Subject: Nueva tarea asignada: ...` en la salida del sumidero.

Expected: el correo aparece una vez; si el admin se asigna la tarea a sí mismo, no aparece.

- [ ] **Step 5: `tsc` y commit**

Run: `npx tsc --noEmit -p tsconfig.json` (si el proyecto usa `tsconfig.app.json`/`tsconfig.node.json`, correr `npx tsc --noEmit -p` en el que cubra `server/`). Expected: sin errores.

```bash
git add server/index.ts
git commit -m "feat: email assignee when an admin creates a task"
```

---

### Task 4: Aviso de retraso (revisor periódico)

**Files:**
- Create: `server/overdue.ts`, `server/overdue.test.ts`
- Modify: `server/index.ts` (migración `overdueNotifiedAt`, resets en `activity:update` / `activity:updateStatus`, `setInterval`), `src/db.ts` y `server/index.ts` interface `Activity` (campo opcional)

**Interfaces:**
- Consumes: `Mailer`, `overdueMessage` (Task 2).
- Produces:
  - `localToday(now?: Date): string` → `YYYY-MM-DD` en hora local del servidor.
  - `runOverdueCheck(db: Database, mailer: Mailer, today: string): Promise<number>` → cantidad de avisos enviados y marcados.
  - Columna `activities.overdueNotifiedAt TEXT`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`server/overdue.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { localToday, runOverdueCheck } from './overdue.ts';
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
  assert.ok((await db.get("SELECT overdueNotifiedAt v FROM activities WHERE id='1'")).v);
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
  await db.run("UPDATE users SET email='sin@x.com' WHERE username='Sin'");
  assert.equal(await runOverdueCheck(db, mailer, '2026-10-16'), 1);
  assert.equal(sent[0].to, 'sin@x.com');
});

test('fallo SMTP: no marca y reintenta después', async () => {
  const db = await makeDb();
  await addAct(db, '1', '2026-10-01', 'todo');
  const bad = createMailer({ sendMail: async () => { throw new Error('down'); } }, 'k@x.com');
  assert.equal(await runOverdueCheck(db, bad, '2026-10-16'), 0);
  const { sent, mailer } = okMailer();
  assert.equal(await runOverdueCheck(db, mailer, '2026-10-16'), 1);
  assert.equal(sent.length, 1);
});

test('mailer deshabilitado no marca nada', async () => {
  const db = await makeDb();
  await addAct(db, '1', '2026-10-01', 'todo');
  assert.equal(await runOverdueCheck(db, createMailer(null, ''), '2026-10-16'), 0);
  assert.equal((await db.get("SELECT overdueNotifiedAt v FROM activities WHERE id='1'")).v, null);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npm run test:server`
Expected: FAIL (`Cannot find module './overdue.ts'`).

- [ ] **Step 3: Implementar `server/overdue.ts`**

```ts
import type { Database } from 'sqlite';
import { overdueMessage, type Mailer } from './mailer.ts';

export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

interface OverdueRow {
  id: string;
  title: string;
  description: string;
  endDate: string;
  priority: string;
  email: string | null;
}

// Sends one "overdue" email per task and stamps overdueNotifiedAt. A task is only
// stamped after a successful send, so SMTP failures and users without an email are
// retried on the next pass.
export async function runOverdueCheck(db: Database, mailer: Mailer, today: string): Promise<number> {
  if (!mailer.enabled) return 0;
  const rows = await db.all<OverdueRow[]>(
    `SELECT a.id, a.title, a.description, a.endDate, a.priority, u.email
       FROM activities a
       LEFT JOIN users u ON u.username = a.username COLLATE NOCASE
      WHERE a.endDate != '' AND a.endDate < ?
        AND a.status NOT IN ('done', 'cancelled')
        AND a.overdueNotifiedAt IS NULL`,
    [today]
  );
  let sent = 0;
  for (const row of rows) {
    if (!row.email) continue;
    const { subject, text } = overdueMessage(row);
    if (!(await mailer.send(row.email, subject, text))) continue;
    await db.run('UPDATE activities SET overdueNotifiedAt = ? WHERE id = ?', [new Date().toISOString(), row.id]);
    sent += 1;
  }
  return sent;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test:server`
Expected: PASS (todas).

- [ ] **Step 5: Conectar en `server/index.ts`**

Importar: `import { localToday, runOverdueCheck } from './overdue.ts';`

Migración (junto a las demás, antes de `seedDatabaseIfEmpty()`):

```ts
  try {
    await db.exec("ALTER TABLE activities ADD COLUMN overdueNotifiedAt TEXT;");
  } catch {
    // Column might already exist
  }
```

`getActivities` ya hace `...r`, así que el campo viaja al cliente sin más; en `interface Activity` (servidor) agregar `overdueNotifiedAt?: string | null;`.

`activity:updateStatus` — reemplazar el `UPDATE` por (reinicia la marca si la tarea sale de done/cancelled):

```ts
    await db.run(
      `UPDATE activities SET status = ?, completedAt = ?, progress = ?, archived = 0,
         overdueNotifiedAt = CASE WHEN status IN ('done','cancelled') AND ? NOT IN ('done','cancelled') THEN NULL ELSE overdueNotifiedAt END
       WHERE id = ?`,
      [status, completedAt, nextProgress ?? null, status, id]
    );
```

`activity:update` — agregar al `SET` (antes de `WHERE id = ?`) y a los parámetros, en la posición correspondiente:

```ts
       ..., completedAt = ?,
         overdueNotifiedAt = CASE WHEN endDate != ? OR (status IN ('done','cancelled') AND ? NOT IN ('done','cancelled')) THEN NULL ELSE overdueNotifiedAt END
       WHERE id = ?`,
      [ ..., updatedAct.completedAt || null, updatedAct.endDate, updatedAct.status, updatedAct.id ]
```

Intervalo, junto al de limpieza de presencia:

```ts
async function checkOverdue() {
  try {
    const n = await runOverdueCheck(db, mailer, localToday());
    if (n > 0) console.log(`[Kanban Server] ${n} aviso(s) de tarea retrasada enviado(s)`);
  } catch (err) {
    console.error('[Kanban Server] Falló la revisión de tareas retrasadas:', err);
  }
}
setInterval(checkOverdue, 5 * 60 * 1000);
```

Y en `initSQLite().then(() => { ... })`, tras `httpServer.listen(...)`: `void checkOverdue();`

- [ ] **Step 6: Verificación de migración y reset**

Run: repetir la comprobación de migración de Task 1 Step 6 y además:
```bash
sqlite3 <copia> "pragma table_info(activities);" | grep overdueNotifiedAt
```
Expected: la columna existe; conteos de usuarios/actividades iguales. Con el sumidero SMTP de Task 3, una tarea con `endDate` pasado genera un solo correo "Tarea retrasada"; reiniciar el servidor no lo repite; cambiar su `endDate` a otro día pasado (editando en la UI) y esperar el ciclo (o reiniciar) lo envía una vez más.

- [ ] **Step 7: `tsc` y commit**

Run: `npm run test:server && npx tsc --noEmit -p tsconfig.json`
Expected: pruebas en verde, sin errores de tipos.

```bash
git add server/overdue.ts server/overdue.test.ts server/index.ts
git commit -m "feat: one-time overdue task email via periodic checker"
```

---

### Task 5: Cliente — correo del usuario

**Files:**
- Modify: `src/db.ts` (tipos y funciones), `src/App.tsx` (estado, login de usuario nuevo, modal de creación, diálogo de correo, botón en fila de usuario admin)

**Interfaces:**
- Consumes: eventos `user:create` (con `email`), `user:login` (con `email`), `user:setEmail` (Task 1).
- Produces: `User.email?: string | null`; `Activity.overdueNotifiedAt?: string | null` (campo informativo, Task 6 no lo necesita); `setUserEmail(username: string, email: string): Promise<AuthResult>`.

- [ ] **Step 1: `src/db.ts`**

En `interface User` agregar `email?: string | null;`; en `interface Activity` agregar `overdueNotifiedAt?: string | null;`.

Cambiar:

```ts
export const loginUser = async (username: string, fullName?: string, role?: 'admin' | 'user', email?: string): Promise<User> => {
  const user: User = { username, fullName, role, lastLogin: new Date().toISOString() };
  socket.emit('user:login', { username, fullName, email });
  return user;
};

export const createUserByAdmin = async (username: string, fullName: string, role: 'admin' | 'user', email: string, password?: string): Promise<void> => {
  socket.emit('user:create', { username, fullName, role, email, password });
};
```

Agregar, junto a `changeAdminPassword`:

```ts
export const setUserEmail = (username: string, email: string): Promise<AuthResult> =>
  emitWithAck('user:setEmail', { username, email });
```

(`AuthResult.error` ya es un union de strings; ampliarlo con `'invalid_email' | 'not_found'`.)

- [ ] **Step 2: Estado y validación en `App.tsx`**

Importar `setUserEmail` desde `./db`. Junto a los demás `useState` (~l.74):

```tsx
  const [emailInput, setEmailInput] = useState('');            // login: usuario nuevo
  const [newUserEmail, setNewUserEmail] = useState('');        // modal "Agregar usuario"
  const [emailEditTarget, setEmailEditTarget] = useState<string | null>(null); // admin edita el correo de otro
  const [emailDialogValue, setEmailDialogValue] = useState('');
  const [emailDialogError, setEmailDialogError] = useState('');
```

Helper a nivel de módulo (antes del componente):

```tsx
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmailValid = (v: string) => EMAIL_RE.test(v.trim());
```

Derivado en el cuerpo del componente (junto a `isAdmin`):

```tsx
  const currentUserRecord = user ? users.find(u => u.username.toLowerCase() === user.username.toLowerCase()) : undefined;
  const mustSetOwnEmail = !!currentUserRecord && !currentUserRecord.email;
  const emailDialogTarget = emailEditTarget ?? (mustSetOwnEmail ? user!.username : null);
```

- [ ] **Step 3: Usuario nuevo en el login**

En `handleLogin`, dentro de `if (isNewUserPrompt)`, después de validar el nombre:

```tsx
      if (!isEmailValid(emailInput)) {
        setErrorMsg('Escribe un correo electrónico válido');
        return;
      }
```

Pasar el correo en la llamada final: `loginUser(..., existingUser?.role || (...), isNewUserPrompt ? emailInput.trim() : undefined)` y limpiar `setEmailInput('')` junto a `setFullNameInput('')`. Hacer lo mismo en `handleLogout`.

En el JSX, dentro del bloque `auth-expandable-content` del nombre (después del `<p>` de ayuda), agregar:

```tsx
                <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                  <label className="form-label">Correo electrónico</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="Ej. juan@empresa.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    required={isNewUserPrompt}
                  />
                </div>
```

- [ ] **Step 4: Modal "Agregar usuario"**

En `openCreateUserModal` agregar `setNewUserEmail('');`. En `handleSaveNewUser`, tras validar usuario/nombre:

```tsx
    if (!isEmailValid(newUserEmail)) {
      setCreateUserError('Escribe un correo electrónico válido.');
      return;
    }
```

y cambiar la llamada: `await createUserByAdmin(cleanUsername, cleanFullName, newUserRole, newUserEmail.trim(), newUserRole === 'admin' ? newUserPassword : undefined);`

En el formulario, después del grupo "Nombre y Apellido":

```tsx
              <div className="form-group">
                <label className="form-label">Correo electrónico</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="Ej. carlos@empresa.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  required
                />
              </div>
```

- [ ] **Step 5: Diálogo de correo (obligatorio / edición)**

Handler:

```tsx
  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailDialogTarget) return;
    if (!isEmailValid(emailDialogValue)) {
      setEmailDialogError('Escribe un correo electrónico válido.');
      return;
    }
    const res = await setUserEmail(emailDialogTarget, emailDialogValue.trim());
    if (!res.ok) {
      setEmailDialogError(res.error === 'timeout' ? 'No se pudo conectar con el servidor' : 'No se pudo guardar el correo.');
      return;
    }
    setEmailEditTarget(null);
    setEmailDialogValue('');
    setEmailDialogError('');
  };
  const openEmailEditor = (u: User, e: React.MouseEvent) => {
    e.stopPropagation();
    setEmailDialogValue(u.email || '');
    setEmailDialogError('');
    setEmailEditTarget(u.username);
  };
```

JSX (junto al modal de crear usuario). Es bloqueante cuando `mustSetOwnEmail` y no se está editando a otro: sin botón de cerrar ni cierre al hacer clic fuera:

```tsx
      {emailDialogTarget && (
        <div className="modal-overlay" onClick={() => { if (emailEditTarget) setEmailEditTarget(null); }}>
          <div className="glass-panel modal-content animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-rounded" style={{ color: 'var(--color-primary)' }}>mail</span>
                {emailEditTarget ? `Correo de ${emailEditTarget}` : 'Registra tu correo electrónico'}
              </h3>
              {emailEditTarget && (
                <button type="button" className="modal-close" onClick={() => setEmailEditTarget(null)} aria-label="Cerrar">
                  <span className="material-symbols-rounded">close</span>
                </button>
              )}
            </div>
            <form onSubmit={handleSaveEmail} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {!emailEditTarget && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                  Necesitamos tu correo para avisarte de tareas nuevas y retrasadas.
                </p>
              )}
              <div className="form-group">
                <label className="form-label">Correo electrónico</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="Ej. juan@empresa.com"
                  value={emailDialogValue}
                  onChange={(e) => setEmailDialogValue(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              {emailDialogError && <p className="form-error" style={{ margin: 0 }}>{emailDialogError}</p>}
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}
```

En la fila de usuario del panel admin (`admin-user-head`, junto al botón de eliminar) agregar un botón que abre el editor, y mostrar el correo bajo "Última sesión":

```tsx
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon-only delete-user-btn"
                        onClick={(e) => openEmailEditor(u, e)}
                        title="Editar correo"
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>mail</span>
                      </button>
```
```tsx
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {u.email || 'Sin correo registrado'}
                    </span>
```

Nota: `mustSetOwnEmail` se evalúa tras recibir `users:all`; mientras la lista no haya llegado (`currentUserRecord` indefinido) no se muestra el diálogo, así que no hay parpadeo falso.

- [ ] **Step 6: Verificar tipos y build**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run build && npx oxlint src/`
Expected: sin errores.

- [ ] **Step 7: Verificar en navegador (Playwright)**

Con `npm run dev` corriendo (la base de Downloads tiene usuarios sin correo):
1. Entrar como `Carlos` (usuario existente sin correo) → aparece el diálogo "Registra tu correo electrónico" sin botón de cerrar; clic fuera no lo cierra; correo inválido muestra error; correo válido lo cierra y no vuelve a aparecer tras recargar.
2. Entrar con un usuario nuevo → el formulario pide Nombre y correo y rechaza correo inválido.
3. Como admin: "Agregar usuario" exige correo; el icono de sobre en una fila abre el editor y actualiza el correo mostrado.
Capturar pantallas de (1) en tema claro y oscuro.

- [ ] **Step 8: Commit**

```bash
git add src/db.ts src/App.tsx
git commit -m "feat: collect required user email (login, admin create/edit, blocking dialog)"
```

---

### Task 6: Cliente — tareas retrasadas en rojo

**Files:**
- Modify: `src/App.tsx` (helper `todayString`, estado `today`, `isOverdue`, clase y etiqueta en columnas Por Realizar / En Realización y mini-tarjetas admin), `src/App.css`

**Interfaces:**
- Produces: `isOverdue(a: Activity): boolean` — `a.endDate < today && a.status !== 'done' && a.status !== 'cancelled'`.

- [ ] **Step 1: Helper y estado**

A nivel de módulo en `App.tsx`:

```tsx
const todayString = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
```

Dentro del componente, junto a `presenceTick` (~l.93):

```tsx
  const [today, setToday] = useState(todayString);
  const isOverdue = (a: Activity) =>
    !!a.endDate && a.endDate < today && a.status !== 'done' && a.status !== 'cancelled';
```

Y un efecto (junto al del `presenceTick`, ~l.239) que refresca "hoy" cada minuto:

```tsx
  useEffect(() => {
    const t = setInterval(() => setToday(todayString()), 60_000);
    return () => clearInterval(t);
  }, []);
```

- [ ] **Step 2: Clase y etiqueta en las tarjetas**

En las columnas **todo** (`border-todo`, ~l.1369) y **doing** (`border-doing`, ~l.1427) cambiar el `className`:

```tsx
                  className={`task-card border-todo animate-fade-in ${isOverdue(act) ? 'overdue' : ''}`}
```
(`border-doing` análogo). La columna **done** no cambia (una tarea terminada nunca está retrasada).

En esas dos columnas, justo después de `<h4 className="task-title">{act.title}</h4>` agregar:

```tsx
                      {isOverdue(act) && (
                        <span className="overdue-badge" title={`Debía terminar el ${act.endDate}`}>Retrasada</span>
                      )}
```
Como el `<h4>` está en un contenedor `display:flex; justify-content: space-between`, envolver título y etiqueta en un `<div style={{ display:'flex', gap:'0.4rem', alignItems:'center', minWidth:0 }}>` para que el icono de editar siga a la derecha.

En las mini-tarjetas del panel admin (`admin-mini-card mini-todo` ~l.1208 y `mini-doing` ~l.1234):

```tsx
className={`admin-mini-card mini-todo ${isOverdue(a) ? 'overdue' : ''}`}
```

- [ ] **Step 3: Estilos con tokens (`src/App.css`)**

Después de `.border-done`:

```css
/* Overdue tasks — red tint driven by the --color-danger token so it flips with the theme */
.task-card.overdue,
.admin-mini-card.overdue {
  border-color: rgba(var(--color-danger-rgb), 0.55);
  border-left: 4px solid var(--color-danger);
  background-image: linear-gradient(rgba(var(--color-danger-rgb), 0.12), rgba(var(--color-danger-rgb), 0.12));
}

.overdue-badge {
  flex-shrink: 0;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--color-danger);
  background: rgba(var(--color-danger-rgb), 0.14);
  border: 1px solid rgba(var(--color-danger-rgb), 0.4);
}
```

- [ ] **Step 4: Verificar tipos, build y lint**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run build && npx oxlint src/`
Expected: sin errores.

- [ ] **Step 5: Verificación visual (Playwright, obligatoria según CLAUDE.md)**

Con `npm run dev`, entrar como admin y revisar el tablero (hay 9 actividades en la base; crear una con fecha de fin pasada si ninguna lo está):
1. La tarea con `endDate` pasado y estado Por Realizar / En Realización se ve con fondo y borde rojizos y la etiqueta "Retrasada"; las demás no cambian.
2. Una tarea en Realizado con fecha pasada **no** se pinta de rojo.
3. Repetir en tema claro y oscuro (botón de tema) y capturar pantalla de ambos; el texto del título sigue legible.
4. Mover una tarea retrasada a Realizado → deja de estar roja de inmediato.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat: highlight overdue tasks with red tint and badge"
```

---

### Task 7: Documentación y verificación final

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `Dockerfile`

- [ ] **Step 1: README**

Agregar una sección "Correos" con: qué avisos se envían; variables `SMTP_HOST`, `SMTP_PORT` (587 por defecto, 465 usa TLS), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`; que con Gmail se necesita una **contraseña de aplicación**; que la zona horaria del servidor define cuándo "es hoy" (en Docker, definir `TZ`); y que sin variables SMTP la app funciona pero no envía correos. Ejemplo de ejecución:

```bash
SMTP_HOST=smtp.gmail.com SMTP_USER=avisos@tudominio.com SMTP_PASS=xxxx npm run dev
```

- [ ] **Step 2: Dockerfile**

En el stage de runtime, junto al `ENV PORT=3001 ...`, documentar con comentario (sin valores secretos) que `SMTP_*`/`MAIL_FROM`/`TZ` se pasan en `docker run -e` o en el orquestador.

- [ ] **Step 3: CLAUDE.md**

Actualizar: (a) la nota "No test suite exists" → existe `npm run test:server` (node:test) que cubre `server/email.ts`, `mailer.ts`, `overdue.ts`; el cliente sigue sin pruebas; (b) nueva sección corta "Correos y tareas retrasadas": columnas `users.email` (obligatoria a nivel de app, nullable en BD) y `activities.overdueNotifiedAt`, el revisor de 5 min, que la marca solo se pone tras un envío exitoso, los resets, y que `isOverdue` del cliente es independiente del servidor.

- [ ] **Step 4: Verificación completa**

Run:
```bash
npm run test:server && npx tsc --noEmit -p tsconfig.app.json && npm run build && npx oxlint src/
```
Expected: todo en verde.

Prueba de punta a punta con el sumidero SMTP: (1) como admin crear tarea para un usuario con correo → un correo "Nueva tarea asignada"; (2) tarea con `endDate` pasado → un correo "Tarea retrasada" en el siguiente ciclo (o al reiniciar) y ninguno más al reiniciar de nuevo; (3) sin variables SMTP el servidor arranca, crea tareas y solo imprime la advertencia.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md Dockerfile
git commit -m "docs: document email notifications, SMTP env vars and server tests"
```
