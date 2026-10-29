import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'crypto';
import { normalizeEmail } from './email.ts';
import { createMailer, mailerFromConfig, newTaskMessage, sharedTaskMessage, commentMessage, testMessage, type Mailer } from './mailer.ts';
import { ensureSettingsTable, getSetting, setSetting, resolveMailConfig, saveMailConfig, publicMailSettings } from './settings.ts';
import { autoCompleteAtFull } from './autocomplete.ts';
import { validateNewUser, createUser, touchLogin } from './users.ts';
import { changeUserRole } from './roles.ts';
import { updateProfile, parsePhoto } from './profile.ts';
import { createOverdueChecker, localToday, msUntilNextLocalMidnight } from './overdue.ts';
import { isRepeat, normalizeRule, ensureRecurrenceTable, createSeries, stopSeries, dropSeriesWhere, runRecurrences } from './recurrence.ts';
import { changeKind, type KindChangeInput } from './kindChange.ts';
import {
  validateShared, createSharedTask, syncSharedFields, ensureCommentsTable, ensureCommentReadsTable, pruneComments, addComment, sharedRecipients,
  markCommentsRead, commentRecipients, setParticipants,
} from './shared.ts';

interface Activity {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  status: 'todo' | 'doing' | 'done' | 'cancelled';
  username: string;
  createdAt: string;
  assignedBy?: string | null;
  priority: 'alta' | 'media' | 'baja';
  progress?: number | null;
  teamId?: string | null;
  completedAt?: string | null;
  archived?: boolean;
  overdueNotifiedAt?: string | null;
  // 'single' (a normal task), 'shared' (one copy per participant, linked by sharedId) or
  // 'recurring' (an occurrence of a series; `repeat` comes from the series row).
  kind?: 'single' | 'shared' | 'recurring';
  sharedId?: string | null;
  seriesId?: string | null;
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
}

interface User {
  username: string;
  fullName?: string;
  role?: 'admin' | 'user';
  lastLogin: string;
  email?: string | null;
  photoUpdatedAt?: string | null;
}

interface Team {
  id: string;
  name: string;
  memberUsernames: string[];
  createdAt: string;
}

interface PresenceEntry {
  username: string;
  context: string;
  lastSeen: number;
}

const app = express();
app.use(cors());
app.use(express.json());

// Profile photos. The users list only carries `photoUpdatedAt`; the image itself is fetched here
// (the client adds ?v=<photoUpdatedAt>, so a changed photo is a new URL and can be cached forever).
app.get('/api/avatar/:username', async (req, res) => {
  const row = await db.get<{ photo: string | null }>('SELECT photo FROM users WHERE username = ? COLLATE NOCASE', [req.params.username]);
  const photo = parsePhoto(row?.photo);
  if (!photo) {
    res.status(404).end();
    return;
  }
  res.set({
    'Content-Type': photo.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(photo.data);
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Defaults to a path next to the source tree for local dev; in Docker this is
// overridden to a mounted volume (see Dockerfile/DB_PATH) so the database
// survives container restarts and image rebuilds.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../kanban.db');
// Built from the settings table (falling back to GMAIL_* env vars) once the DB is open, and
// rebuilt whenever an admin saves new mail settings.
let mailer: Mailer = createMailer(null, '');

let db: Database;

async function initSQLite() {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      fullName TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      lastLogin TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      memberUsernames TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      startDate TEXT NOT NULL,
      endDate TEXT NOT NULL,
      status TEXT NOT NULL,
      username TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      assignedBy TEXT,
      priority TEXT NOT NULL,
      progress INTEGER,
      teamId TEXT,
      completedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS presence (
      username TEXT PRIMARY KEY,
      context TEXT NOT NULL,
      lastSeen INTEGER NOT NULL
    );
  `);

  try {
    await db.exec("ALTER TABLE users ADD COLUMN fullName TEXT;");
  } catch {
    // Column might already exist
  }

  try {
    await db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';");
  } catch {
    // Column might already exist
  }

  try {
    await db.exec("ALTER TABLE activities ADD COLUMN progress INTEGER;");
  } catch {
    // Column might already exist
  }

  try {
    await db.exec("ALTER TABLE activities ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;");
  } catch {
    // Column might already exist
  }

  try {
    await db.exec("ALTER TABLE users ADD COLUMN passwordHash TEXT;");
  } catch {
    // Column might already exist
  }

  try {
    await db.exec("ALTER TABLE users ADD COLUMN email TEXT;");
  } catch {
    // Column might already exist
  }

  try {
    await db.exec("ALTER TABLE activities ADD COLUMN overdueNotifiedAt TEXT;");
  } catch {
    // Column might already exist
  }

  for (const sql of [
    "ALTER TABLE activities ADD COLUMN kind TEXT NOT NULL DEFAULT 'single';",
    'ALTER TABLE activities ADD COLUMN sharedId TEXT;',
    'ALTER TABLE activities ADD COLUMN seriesId TEXT;',
    'ALTER TABLE users ADD COLUMN photo TEXT;',
    'ALTER TABLE users ADD COLUMN photoUpdatedAt TEXT;',
  ]) {
    try {
      await db.exec(sql);
    } catch {
      // Column might already exist
    }
  }
  await ensureRecurrenceTable(db);
  await ensureCommentsTable(db);
  await ensureCommentReadsTable(db);

  await ensureSettingsTable(db);
  mailer = mailerFromConfig(await resolveMailConfig(db));

  // One-time: tasks already at 100% progress but still in todo/doing go to "done"
  // (the same rule activity:update now applies when progress reaches 100).
  if (!(await getSetting(db, 'sweep_100_done'))) {
    const now = new Date().toISOString();
    await db.run(
      "UPDATE activities SET status = 'done', completedAt = COALESCE(completedAt, ?), archived = 0 WHERE progress >= 100 AND status IN ('todo', 'doing')",
      [now]
    );
    await setSetting(db, 'sweep_100_done', now);
  }

  await seedDatabaseIfEmpty();
  await ensureAdminPasswords();
}

async function seedDatabaseIfEmpty() {
  const countRow = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM users');
  if (countRow && countRow.count > 0) return;

  const now = new Date().toISOString();
  await db.run('INSERT INTO users (username, fullName, role, lastLogin) VALUES (?, ?, ?, ?)', ['admin', 'Administrador Principal', 'admin', now]);
}

// usernames are case-insensitive for the app (the client always compares them
// lowercased) but SQLite's PRIMARY KEY is case-sensitive, so "Ruben" and "ruben"
// would become two users. Reuse the row that already exists, whatever its casing.
async function canonicalUsername(username: string): Promise<string> {
  const row = await db.get<{ username: string }>('SELECT username FROM users WHERE username = ? COLLATE NOCASE', [username]);
  return row ? row.username : username;
}

// --- Admin passwords --------------------------------------------------------
// Stored as "salt:hash" (hex), scrypt with a per-user random salt. The hash never
// leaves the server: getUsers() selects explicit columns, so `users:all` has none.
const DEFAULT_ADMIN_PASSWORD = 'admin';
const MIN_PASSWORD_LENGTH = 4;

const scryptAsync = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)))
  );

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const isAdminRow = (row: { username: string; role: string | null }) =>
  row.role === 'admin' || row.username.toLowerCase() === 'admin';

// An admin with no password yet (migrated from before passwords existed, or
// promoted straight in the database) starts with the default one.
async function ensureAdminPasswords() {
  const rows = await db.all<{ username: string; role: string | null; passwordHash: string | null }[]>(
    'SELECT username, role, passwordHash FROM users'
  );
  for (const row of rows) {
    if (isAdminRow(row) && !row.passwordHash) {
      await db.run('UPDATE users SET passwordHash = ? WHERE username = ?', [await hashPassword(DEFAULT_ADMIN_PASSWORD), row.username]);
    }
  }
}

// Helpers to fetch and emit dataset updates
async function getActivities(): Promise<Activity[]> {
  const rows = await db.all<any[]>(
    'SELECT a.*, r.repeat AS repeat, r.day AS repeatDay, r.month AS repeatMonth FROM activities a LEFT JOIN recurrences r ON r.id = a.seriesId'
  );
  return rows.map(r => ({
    ...r,
    sharedId: r.sharedId || undefined,
    seriesId: r.seriesId || undefined,
    repeat: r.repeat || undefined,
    repeatDay: r.repeatDay ?? undefined,
    repeatMonth: r.repeatMonth ?? undefined,
    assignedBy: r.assignedBy || undefined,
    progress: r.progress !== null && r.progress !== undefined ? Number(r.progress) : undefined,
    teamId: r.teamId || undefined,
    completedAt: r.completedAt || undefined,
    archived: !!r.archived,
  }));
}

async function getUsers(): Promise<User[]> {
  return await db.all<User[]>('SELECT username, fullName, role, lastLogin, email, photoUpdatedAt FROM users');
}

async function getTeams(): Promise<Team[]> {
  const rows = await db.all<any[]>('SELECT * FROM teams');
  return rows.map(r => ({
    ...r,
    memberUsernames: JSON.parse(r.memberUsernames || '[]'),
  }));
}

async function getPresence(): Promise<PresenceEntry[]> {
  return await db.all<PresenceEntry[]>('SELECT * FROM presence');
}

async function getComments() {
  return await db.all('SELECT id, sharedId, username, text, createdAt FROM comments ORDER BY createdAt');
}

async function getCommentReads() {
  return await db.all('SELECT username, sharedId, lastReadAt FROM comment_reads');
}

async function broadcastActivities() {
  io.emit('activities:all', await getActivities());
}

async function broadcastComments() {
  io.emit('comments:all', await getComments());
  io.emit('commentReads:all', await getCommentReads());
}

// Deleting tasks may leave a shared task's comments with no copy to hang from.
async function cleanupAfterDelete() {
  await pruneComments(db);
  await broadcastComments();
}

async function broadcastUsers() {
  io.emit('users:all', await getUsers());
}

async function broadcastTeams() {
  io.emit('teams:all', await getTeams());
}

async function broadcastPresence() {
  io.emit('presence:all', await getPresence());
}

// Fire-and-forget: a mail problem must never block or fail the task creation.
async function notifyNewTask(task: Activity) {
  if (!mailer.enabled || !task.assignedBy) return;
  const assigner = await db.get<{ username: string; fullName: string | null; role: string | null }>(
    'SELECT username, fullName, role FROM users WHERE username = ? COLLATE NOCASE', [task.assignedBy]
  );
  if (!assigner || !isAdminRow(assigner)) return;
  if (assigner.username.toLowerCase() === task.username.toLowerCase()) return;
  const assignee = await db.get<{ email: string | null; fullName: string | null; username: string }>(
    'SELECT email, fullName, username FROM users WHERE username = ? COLLATE NOCASE', [task.username]
  );
  if (!assignee?.email) return;
  const { subject, text, html } = newTaskMessage(task, assigner.fullName || assigner.username, {
    name: assignee.fullName || assignee.username, today: localToday(), appUrl: process.env.APP_URL,
  });
  await mailer.send(assignee.email, subject, text, html);
}

// A shared task tells every participant and every admin (once each, never the creator).
async function notifySharedTask(task: { title: string; description: string; endDate: string; priority: string }, creator: string, usernames: string[], onlyTo?: string[]) {
  if (!mailer.enabled) return;
  const people = await db.all<{ username: string; fullName: string | null; email: string | null; role: string | null }[]>(
    'SELECT username, fullName, email, role FROM users'
  );
  const nameOf = (u: string) => {
    const p = people.find(x => x.username.toLowerCase() === u.toLowerCase());
    return p?.fullName || p?.username || u;
  };
  const creatorName = nameOf(creator);
  const names = usernames.map(nameOf);
  const only = onlyTo ? new Set(onlyTo.map(u => u.toLowerCase())) : null;
  for (const r of sharedRecipients(people, usernames, creator)) {
    if (only && !only.has(r.username.toLowerCase())) continue;
    const { subject, text, html } = sharedTaskMessage(task, creatorName, names, {
      name: r.fullName || r.username, today: localToday(), appUrl: process.env.APP_URL, participant: r.participant,
    });
    await mailer.send(r.email, subject, text, html);
  }
}

// A comment on a shared task emails the other participants, but only the first unread one each (see commentRecipients).
async function notifyComment(sharedId: string, author: string, text: string) {
  if (!mailer.enabled) return;
  const task = await db.get<{ title: string; description: string; endDate: string; priority: string }>(
    'SELECT title, description, endDate, priority FROM activities WHERE sharedId = ? LIMIT 1', [sharedId]
  );
  const authorRow = await db.get<{ username: string; fullName: string | null }>('SELECT username, fullName FROM users WHERE username = ? COLLATE NOCASE', [author]);
  if (!task || !authorRow) return;
  const authorName = authorRow.fullName || authorRow.username;
  for (const r of await commentRecipients(db, sharedId, authorRow.username)) {
    const { subject, text: body, html } = commentMessage(task, authorName, text, {
      name: r.fullName || r.username, appUrl: process.env.APP_URL,
    });
    await mailer.send(r.email, subject, body, html);
  }
}

// Socket Connection handling
io.on('connection', async (socket) => {
  // Send initial data to newly connected client
  socket.emit('activities:all', await getActivities());
  socket.emit('users:all', await getUsers());
  socket.emit('teams:all', await getTeams());
  socket.emit('presence:all', await getPresence());
  socket.emit('comments:all', await getComments());
  socket.emit('commentReads:all', await getCommentReads());

  // Activity handlers
  socket.on('activity:add', async (activityData: Omit<Activity, 'id' | 'createdAt'>) => {
    const id = 'act_' + Math.random().toString(36).substring(2, 11);
    const createdAt = new Date().toISOString();
    const completedAt = activityData.status === 'done' ? createdAt : null;
    const progress = activityData.status === 'done' ? 100 : activityData.status === 'doing' ? (typeof activityData.progress === 'number' ? activityData.progress : 50) : (typeof activityData.progress === 'number' ? activityData.progress : 0);

    // A repeating task has no dates of its own: the first occurrence is created today and the
    // series row keeps the template and the rule (which weekday / day of the month it comes back).
    const rule = isRepeat(activityData.repeat) ? normalizeRule(activityData.repeat, activityData.repeatDay, activityData.repeatMonth) : null;
    const startDate = rule ? localToday() : activityData.startDate;
    const endDate = rule ? '' : activityData.endDate;
    const seriesId = rule
      ? await createSeries(db, {
          rule, title: activityData.title, description: activityData.description,
          priority: activityData.priority, username: activityData.username, assignedBy: activityData.assignedBy || null,
          teamId: activityData.teamId || null, startDate,
        })
      : null;

    await db.run(
      `INSERT INTO activities (id, title, description, startDate, endDate, status, username, createdAt, assignedBy, priority, progress, teamId, completedAt, kind, seriesId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        activityData.title,
        activityData.description,
        startDate,
        endDate,
        activityData.status,
        activityData.username,
        createdAt,
        activityData.assignedBy || null,
        activityData.priority,
        progress,
        activityData.teamId || null,
        completedAt,
        seriesId ? 'recurring' : 'single',
        seriesId,
      ]
    );
    void notifyNewTask({ ...activityData, startDate, endDate, id, createdAt }).catch(err => console.error('[Mailer] notifyNewTask falló:', err));
    await broadcastActivities();
    void checkOverdue(); // a task created already overdue is notified right away
  });

  // A shared task: one copy per selected person, then one email to the participants and the admins.
  socket.on('activity:addShared', async (
    payload: Record<string, unknown>,
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => {
    const reply = ack ?? (() => {});
    const known = (await db.all<{ username: string }[]>('SELECT username FROM users')).map(u => u.username);
    const valid = validateShared(payload ?? {}, known);
    if (!valid.ok) return reply({ ok: false, error: valid.error });
    const task = valid.task;
    await createSharedTask(db, task);
    void notifySharedTask(task, task.assignedBy, task.usernames).catch(err => console.error('[Mailer] notifySharedTask falló:', err));
    await broadcastActivities();
    void checkOverdue();
    reply({ ok: true });
  });

  socket.on('comment:add', async (
    payload: { sharedId?: string; username?: string; text?: string },
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => {
    const reply = ack ?? (() => {});
    const result = await addComment(db, payload ?? {});
    if (result.ok) {
      await broadcastComments();
      void notifyComment(String(payload.sharedId), String(payload.username), String(payload.text)).catch(err => console.error('[Mailer] notifyComment falló:', err));
    }
    reply(result);
  });

  // Opening a shared task's comments marks them read for that person (drives the "new comments" badge).
  socket.on('comments:read', async (payload: { username?: string; sharedId?: string }) => {
    const result = await markCommentsRead(db, payload ?? {});
    if (result.ok) io.emit('commentReads:all', await getCommentReads());
  });

  // Adds or removes people on a shared task. Added people get the same email as at creation.
  socket.on('shared:setParticipants', async (
    payload: { sharedId?: string; usernames?: string[]; by?: string },
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => {
    const reply = ack ?? (() => {});
    const result = await setParticipants(db, payload ?? {});
    if (!result.ok) return reply(result);
    await broadcastActivities();
    await cleanupAfterDelete();
    if (result.added.length > 0) {
      void notifySharedTask(result.task, result.by, result.all, result.added).catch(err => console.error('[Mailer] notifySharedTask falló:', err));
    }
    void checkOverdue();
    reply({ ok: true });
  });

  // The type picked at creation was wrong: turn the task into another type without re-creating it.
  socket.on('activity:changeKind', async (
    payload: KindChangeInput,
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => {
    const reply = ack ?? (() => {});
    const result = await changeKind(db, payload ?? {}, localToday());
    if (!result.ok) return reply(result);
    await broadcastActivities();
    await cleanupAfterDelete();
    if (result.to === 'shared') {
      void notifySharedTask(result.task, result.by, result.all, result.added).catch(err => console.error('[Mailer] notifySharedTask falló:', err));
    }
    void checkOverdue();
    reply({ ok: true });
  });

  socket.on('series:stop', async (id: string) => {
    const row = await db.get<{ seriesId: string | null }>('SELECT seriesId FROM activities WHERE id = ?', [id]);
    if (row?.seriesId) await stopSeries(db, row.seriesId);
    await broadcastActivities();
  });

  socket.on('activity:updateStatus', async ({ id, status, progress }: { id: string; status: Activity['status']; progress?: number }) => {
    const completedAt = status === 'done' ? new Date().toISOString() : null;
    let nextProgress = progress;
    if (status === 'done') nextProgress = 100;
    else if (status === 'todo') nextProgress = 0;
    else if (status === 'doing' && typeof nextProgress !== 'number') nextProgress = 50;

    await db.run(
      `UPDATE activities SET status = ?, completedAt = ?, progress = ?, archived = 0,
         overdueNotifiedAt = CASE WHEN status IN ('done','cancelled') AND ? NOT IN ('done','cancelled') THEN NULL ELSE overdueNotifiedAt END
       WHERE id = ?`,
      [status, completedAt, nextProgress ?? null, status, id]
    );
    await broadcastActivities();
    void checkOverdue();
  });

  socket.on('activity:setArchived', async ({ id, archived }: { id: string; archived: boolean }) => {
    // Any status can be archived (the Archivero keeps the status it had); restoring brings it back.
    await db.run('UPDATE activities SET archived = ? WHERE id = ?', [archived ? 1 : 0, id]);
    await broadcastActivities();
    void checkOverdue(); // a restored, already-overdue task is notified right away
  });

  socket.on('activity:update', async (updatedAct: Activity) => {
    const rawProgress = updatedAct.status === 'done' ? 100 : updatedAct.status === 'doing' ? (typeof updatedAct.progress === 'number' ? updatedAct.progress : 50) : (typeof updatedAct.progress === 'number' ? updatedAct.progress : 0);
    // Raising progress to 100 moves the task to "done" by itself.
    const prev = await db.get<{ progress: number | null }>('SELECT progress FROM activities WHERE id = ?', [updatedAct.id]);
    const next = autoCompleteAtFull(
      { progress: prev?.progress ?? null },
      { status: updatedAct.status, progress: rawProgress, completedAt: updatedAct.completedAt || null },
      new Date().toISOString()
    );
    const progress = next.progress;
    await db.run(
      `UPDATE activities SET title = ?, description = ?, startDate = ?, endDate = ?, status = ?, username = ?, assignedBy = ?, priority = ?, progress = ?, teamId = ?, completedAt = ?,
         overdueNotifiedAt = CASE WHEN endDate != ? OR (status IN ('done','cancelled') AND ? NOT IN ('done','cancelled')) THEN NULL ELSE overdueNotifiedAt END
       WHERE id = ?`,
      [
        updatedAct.title,
        updatedAct.description,
        updatedAct.startDate,
        updatedAct.endDate,
        next.status,
        updatedAct.username,
        updatedAct.assignedBy || null,
        updatedAct.priority,
        progress,
        updatedAct.teamId || null,
        next.completedAt,
        updatedAct.endDate,
        next.status,
        updatedAct.id,
      ]
    );
    // Editing the task itself reaches every copy of a shared task (status/progress stay per person).
    const edited = await db.get<{ sharedId: string | null }>('SELECT sharedId FROM activities WHERE id = ?', [updatedAct.id]);
    if (edited?.sharedId) {
      await syncSharedFields(db, edited.sharedId, {
        title: updatedAct.title, description: updatedAct.description, startDate: updatedAct.startDate,
        endDate: updatedAct.endDate, priority: updatedAct.priority,
      });
    }
    await broadcastActivities();
    void checkOverdue(); // a new/changed end date that is already past is notified right away
  });

  // Deleting a shared task removes only that person's copy. Deleting a repeating task removes it
  // for good: the series stops too, so nothing is regenerated.
  socket.on('activity:delete', async (id: string) => {
    const row = await db.get<{ seriesId: string | null }>('SELECT seriesId FROM activities WHERE id = ?', [id]);
    await db.run('DELETE FROM activities WHERE id = ?', [id]);
    if (row?.seriesId) await stopSeries(db, row.seriesId);
    await broadcastActivities();
    await cleanupAfterDelete();
  });

  socket.on('activity:clearUser', async (username: string) => {
    await dropSeriesWhere(db, 'username', username);
    await db.run('DELETE FROM activities WHERE LOWER(username) = LOWER(?)', [username]);
    await broadcastActivities();
    await cleanupAfterDelete();
  });

  socket.on('activity:clearTeam', async (teamId: string) => {
    await dropSeriesWhere(db, 'teamId', teamId);
    await db.run('DELETE FROM activities WHERE teamId = ?', [teamId]);
    await broadcastActivities();
    await cleanupAfterDelete();
  });

  // User handlers

  // Slow down password guessing from one connection: each consecutive failure
  // waits a bit longer before answering.
  let failedAuthAttempts = 0;
  const failAuth = async (error: string) => {
    failedAuthAttempts += 1;
    await new Promise(r => setTimeout(r, Math.min(failedAuthAttempts * 500, 4000)));
    return { ok: false, error };
  };

  socket.on('auth:login', async (
    payload: { username?: string; password?: string },
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => {
    const reply = ack ?? (() => {});
    const username = typeof payload?.username === 'string' ? payload.username : '';
    const password = typeof payload?.password === 'string' ? payload.password : '';
    const row = await db.get<{ username: string; role: string | null; passwordHash: string | null }>(
      'SELECT username, role, passwordHash FROM users WHERE username = ? COLLATE NOCASE', [username]
    );
    if (!row || !isAdminRow(row)) return reply(await failAuth('bad_password'));
    if (!row.passwordHash) return reply(await failAuth('bad_password'));
    if (!(await verifyPassword(password, row.passwordHash))) return reply(await failAuth('bad_password'));
    failedAuthAttempts = 0;
    reply({ ok: true });
  });

  socket.on('auth:changePassword', async (
    payload: { username?: string; currentPassword?: string; newPassword?: string },
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => {
    const reply = ack ?? (() => {});
    const username = typeof payload?.username === 'string' ? payload.username : '';
    const currentPassword = typeof payload?.currentPassword === 'string' ? payload.currentPassword : '';
    const newPassword = typeof payload?.newPassword === 'string' ? payload.newPassword : '';
    const row = await db.get<{ username: string; role: string | null; passwordHash: string | null }>(
      'SELECT username, role, passwordHash FROM users WHERE username = ? COLLATE NOCASE', [username]
    );
    if (!row || !isAdminRow(row) || !row.passwordHash) return reply(await failAuth('bad_password'));
    if (!(await verifyPassword(currentPassword, row.passwordHash))) return reply(await failAuth('bad_password'));
    if (newPassword.length < MIN_PASSWORD_LENGTH) return reply({ ok: false, error: 'too_short' });
    await db.run('UPDATE users SET passwordHash = ? WHERE username = ?', [await hashPassword(newPassword), row.username]);
    failedAuthAttempts = 0;
    reply({ ok: true });
  });

  // A login only touches an EXISTING user: accounts are created by admins (user:create).
  // Role and admin rights are never granted here.
  socket.on('user:login', async (
    payload: { username: string; fullName?: string; email?: string } | string,
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => {
    const reply = ack ?? (() => {});
    const raw = typeof payload === 'string' ? payload : payload?.username;
    const username = await canonicalUsername(typeof raw === 'string' ? raw : '');
    const fullName = typeof payload === 'string' ? undefined : payload?.fullName;
    const email = typeof payload === 'string' ? null : normalizeEmail(payload?.email);
    if (!(await touchLogin(db, username, fullName, email))) return reply({ ok: false, error: 'unknown_user' });
    await ensureAdminPasswords();
    await broadcastUsers();
    reply({ ok: true });
  });

  // Only an admin can create users; the caller proves it with their own password
  // (verified here, like settings:saveMail), so a raw socket client can't do it.
  socket.on('user:create', async (
    payload: {
      adminUsername?: string; adminPassword?: string;
      username?: string; fullName?: string; role?: string; password?: string; email?: string;
    },
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => {
    const reply = ack ?? (() => {});
    if (!(await checkAdmin(payload?.adminUsername, payload?.adminPassword))) return reply(await failAuth('bad_password'));
    failedAuthAttempts = 0;
    const valid = validateNewUser(payload, MIN_PASSWORD_LENGTH);
    if (!valid.ok) return reply({ ok: false, error: valid.error });
    const u = valid.user;
    const passwordHash = u.role === 'admin' ? await hashPassword(u.password) : null;
    const created = await createUser(db, { username: u.username, fullName: u.fullName, role: u.role, email: u.email, passwordHash });
    if (!created.ok) return reply({ ok: false, error: created.error });
    await broadcastUsers();
    reply({ ok: true });
  });

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

  // A user edits their own profile (name, username, email, photo). An administrator account must
  // also prove its password, like every other admin action; regular accounts have no password (the
  // same known gap as the rest of the app). Renaming is refused for the built-in admin and the role manager.
  socket.on('profile:update', async (
    payload: { username?: string; password?: string; fullName?: string; newUsername?: string; email?: string; photo?: string | null },
    ack?: (res: { ok: boolean; error?: string; username?: string }) => void
  ) => {
    const reply = ack ?? (() => {});
    const username = typeof payload?.username === 'string' ? payload.username : '';
    const row = await db.get<{ username: string; role: string | null }>('SELECT username, role FROM users WHERE username = ? COLLATE NOCASE', [username]);
    if (!row) return reply({ ok: false, error: 'not_found' });
    if (isAdminRow(row)) {
      if (!(await checkAdmin(row.username, payload.password))) return reply(await failAuth('bad_password'));
      failedAuthAttempts = 0;
    }
    const result = await updateProfile(db, row.username, {
      fullName: payload.fullName, newUsername: payload.newUsername, email: payload.email, photo: payload.photo,
    });
    if (!result.ok) return reply(result);
    await broadcastUsers();
    if (result.username !== row.username) {
      await broadcastActivities();
      await broadcastTeams();
      await broadcastComments();
      await broadcastPresence();
    }
    reply(result);
  });

  socket.on('user:delete', async (username: string) => {
    await dropSeriesWhere(db, 'username', username);
    await db.run('DELETE FROM comment_reads WHERE LOWER(username) = LOWER(?)', [username]);
    await db.run('DELETE FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    await db.run('DELETE FROM activities WHERE LOWER(username) = LOWER(?)', [username]);

    const teams = await getTeams();
    for (const team of teams) {
      const filteredMembers = team.memberUsernames.filter(
        m => m.toLowerCase() !== username.toLowerCase()
      );
      if (filteredMembers.length !== team.memberUsernames.length) {
        await db.run('UPDATE teams SET memberUsernames = ? WHERE id = ?', [
          JSON.stringify(filteredMembers),
          team.id,
        ]);
      }
    }

    await broadcastUsers();
    await broadcastActivities();
    await broadcastTeams();
    await cleanupAfterDelete();
  });

  // Mail settings. Reading is open (the secrets never leave the server); changing or
  // testing them needs an admin's password, checked like auth:changePassword.
  const checkAdmin = async (username: unknown, password: unknown) => {
    const row = await db.get<{ username: string; role: string | null; passwordHash: string | null }>(
      'SELECT username, role, passwordHash FROM users WHERE username = ? COLLATE NOCASE',
      [typeof username === 'string' ? username : '']
    );
    if (!row || !isAdminRow(row) || !row.passwordHash) return null;
    return (await verifyPassword(typeof password === 'string' ? password : '', row.passwordHash)) ? row : null;
  };

  socket.on('settings:getMail', async (_payload: unknown, ack?: (res: object) => void) => {
    (ack ?? (() => {}))({ ok: true, settings: await publicMailSettings(db), enabled: mailer.enabled });
  });

  socket.on('settings:saveMail', async (
    payload: { adminUsername?: string; adminPassword?: string; clientId?: string; clientSecret?: string; refreshToken?: string; from?: string },
    ack?: (res: object) => void
  ) => {
    const reply = ack ?? (() => {});
    if (!(await checkAdmin(payload?.adminUsername, payload?.adminPassword))) return reply(await failAuth('bad_password'));
    failedAuthAttempts = 0;
    await saveMailConfig(db, {
      clientId: payload.clientId, clientSecret: payload.clientSecret, refreshToken: payload.refreshToken, from: payload.from,
    });
    mailer = mailerFromConfig(await resolveMailConfig(db));
    reply({ ok: true, enabled: mailer.enabled, settings: await publicMailSettings(db) });
  });

  socket.on('settings:testMail', async (
    payload: { adminUsername?: string; adminPassword?: string },
    ack?: (res: object) => void
  ) => {
    const reply = ack ?? (() => {});
    const admin = await checkAdmin(payload?.adminUsername, payload?.adminPassword);
    if (!admin) return reply(await failAuth('bad_password'));
    failedAuthAttempts = 0;
    if (!mailer.enabled) return reply({ ok: false, error: 'not_configured' });
    const row = await db.get<{ email: string | null; fullName: string | null }>('SELECT email, fullName FROM users WHERE username = ?', [admin.username]);
    if (!row?.email) return reply({ ok: false, error: 'no_email' });
    const { subject, text, html } = testMessage({ name: row.fullName || admin.username, appUrl: process.env.APP_URL });
    const result = await mailer.trySend(row.email, subject, text, html);
    reply({ ok: result.ok, error: result.ok ? undefined : 'send_failed', message: result.error, to: row.email });
  });

  // Changing someone's role: needs an admin's username+password (checked here) AND that admin
  // must be the role manager (see server/roles.ts) — being an admin is not enough.
  socket.on('user:setRole', async (
    payload: { adminUsername?: string; adminPassword?: string; username?: string; role?: string; password?: string },
    ack?: (res: object) => void
  ) => {
    const reply = ack ?? (() => {});
    const admin = await checkAdmin(payload?.adminUsername, payload?.adminPassword);
    if (!admin) return reply(await failAuth('bad_password'));
    failedAuthAttempts = 0;
    const result = await changeUserRole(
      db,
      { manager: admin.username, username: payload.username, role: payload.role, password: payload.password },
      { minPasswordLength: MIN_PASSWORD_LENGTH, hashPassword }
    );
    if (result.ok) await broadcastUsers();
    reply(result);
  });

  // Team handlers
  socket.on('team:create', async ({ name, memberUsernames }: { name: string; memberUsernames: string[] }) => {
    const id = 'team_' + Math.random().toString(36).substring(2, 11);
    const createdAt = new Date().toISOString();
    await db.run(
      'INSERT INTO teams (id, name, memberUsernames, createdAt) VALUES (?, ?, ?, ?)',
      [id, name, JSON.stringify(memberUsernames), createdAt]
    );
    await broadcastTeams();
  });

  socket.on('team:delete', async (teamId: string) => {
    await dropSeriesWhere(db, 'teamId', teamId);
    await db.run('DELETE FROM teams WHERE id = ?', [teamId]);
    await db.run('DELETE FROM activities WHERE teamId = ?', [teamId]);
    await broadcastTeams();
    await broadcastActivities();
    await cleanupAfterDelete();
  });

  // Presence handlers
  socket.on('presence:heartbeat', async ({ username, context }: { username: string; context: string }) => {
    const lastSeen = Date.now();
    await db.run(
      `INSERT INTO presence (username, context, lastSeen) VALUES (?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET context = excluded.context, lastSeen = excluded.lastSeen`,
      [username, context, lastSeen]
    );
    await broadcastPresence();
  });

  socket.on('presence:clear', async (username: string) => {
    await db.run('DELETE FROM presence WHERE LOWER(username) = LOWER(?)', [username]);
    await broadcastPresence();
  });
});

// Periodic cleanup of very stale presence (> 1 hour) from SQLite
setInterval(async () => {
  if (db) {
    const cutoff = Date.now() - 3600000;
    await db.run('DELETE FROM presence WHERE lastSeen < ?', [cutoff]);
  }
}, 60000);

let runOverdueOnce: (() => Promise<number>) | null = null;
async function checkOverdue() {
  try {
    runOverdueOnce ??= createOverdueChecker(db, () => mailer);
    const n = await runOverdueOnce();
    if (n > 0) console.log(`[Kanban Server] ${n} aviso(s) de tarea retrasada enviado(s)`);
  } catch (err) {
    console.error('[Kanban Server] Falló la revisión de tareas retrasadas:', err);
  }
}
setInterval(checkOverdue, 5 * 60 * 1000); // safety net; changes and midnight trigger passes directly

// Creates the occurrences of repeating tasks that came due, then lets everyone see them. The
// new task may itself start already overdue, so an overdue pass follows.
let generatingRecurrences = false;
async function checkRecurrences() {
  if (generatingRecurrences) return;
  generatingRecurrences = true;
  try {
    const n = await runRecurrences(db, localToday());
    if (n > 0) {
      console.log(`[Kanban Server] ${n} tarea(s) repetitiva(s) generada(s)`);
      await broadcastActivities();
      void checkOverdue();
    }
  } catch (err) {
    console.error('[Kanban Server] Falló la generación de tareas repetitivas:', err);
  } finally {
    generatingRecurrences = false;
  }
}
setInterval(checkRecurrences, 5 * 60 * 1000);

// A task becomes overdue (and a repeating one comes due) at local midnight: fire a pass at that
// exact moment instead of waiting for the next 5-minute tick. Recomputed every time.
function scheduleMidnightCheck() {
  setTimeout(() => {
    void checkRecurrences();
    void checkOverdue();
    scheduleMidnightCheck();
  }, msUntilNextLocalMidnight() + 2000);
}

// In the Docker image, the built frontend (`vite build`'s dist/) sits next to
// this file and is served from the same origin/port as the API and sockets —
// no separate nginx process needed. In local dev, dist/ doesn't exist (the
// frontend is served by the Vite dev server instead), so this is a no-op.
const distPath = path.join(__dirname, '../dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;

initSQLite().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`[Kanban Server] Running on http://localhost:${PORT} with SQLite & WebSockets`);
    void checkRecurrences();
    void checkOverdue();
    scheduleMidnightCheck();
  });
}).catch((err) => {
  console.error('Failed to initialize SQLite database:', err);
});
