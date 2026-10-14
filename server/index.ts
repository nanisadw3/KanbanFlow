import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'crypto';

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
}

interface User {
  username: string;
  fullName?: string;
  role?: 'admin' | 'user';
  lastLogin: string;
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
  const rows = await db.all<any[]>('SELECT * FROM activities');
  return rows.map(r => ({
    ...r,
    assignedBy: r.assignedBy || undefined,
    progress: r.progress !== null && r.progress !== undefined ? Number(r.progress) : undefined,
    teamId: r.teamId || undefined,
    completedAt: r.completedAt || undefined,
    archived: !!r.archived,
  }));
}

async function getUsers(): Promise<User[]> {
  return await db.all<User[]>('SELECT username, fullName, role, lastLogin FROM users');
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

async function broadcastActivities() {
  io.emit('activities:all', await getActivities());
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

// Socket Connection handling
io.on('connection', async (socket) => {
  // Send initial data to newly connected client
  socket.emit('activities:all', await getActivities());
  socket.emit('users:all', await getUsers());
  socket.emit('teams:all', await getTeams());
  socket.emit('presence:all', await getPresence());

  // Activity handlers
  socket.on('activity:add', async (activityData: Omit<Activity, 'id' | 'createdAt'>) => {
    const id = 'act_' + Math.random().toString(36).substring(2, 11);
    const createdAt = new Date().toISOString();
    const completedAt = activityData.status === 'done' ? createdAt : null;
    const progress = activityData.status === 'done' ? 100 : activityData.status === 'doing' ? (typeof activityData.progress === 'number' ? activityData.progress : 50) : (typeof activityData.progress === 'number' ? activityData.progress : 0);

    await db.run(
      `INSERT INTO activities (id, title, description, startDate, endDate, status, username, createdAt, assignedBy, priority, progress, teamId, completedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        activityData.title,
        activityData.description,
        activityData.startDate,
        activityData.endDate,
        activityData.status,
        activityData.username,
        createdAt,
        activityData.assignedBy || null,
        activityData.priority,
        progress,
        activityData.teamId || null,
        completedAt,
      ]
    );
    await broadcastActivities();
  });

  socket.on('activity:updateStatus', async ({ id, status, progress }: { id: string; status: Activity['status']; progress?: number }) => {
    const completedAt = status === 'done' ? new Date().toISOString() : null;
    let nextProgress = progress;
    if (status === 'done') nextProgress = 100;
    else if (status === 'todo') nextProgress = 0;
    else if (status === 'doing' && typeof nextProgress !== 'number') nextProgress = 50;

    await db.run('UPDATE activities SET status = ?, completedAt = ?, progress = ?, archived = 0 WHERE id = ?', [status, completedAt, nextProgress ?? null, id]);
    await broadcastActivities();
  });

  socket.on('activity:setArchived', async ({ id, archived }: { id: string; archived: boolean }) => {
    await db.run("UPDATE activities SET archived = ? WHERE id = ? AND status = 'done'", [archived ? 1 : 0, id]);
    await broadcastActivities();
  });

  socket.on('activity:update', async (updatedAct: Activity) => {
    const progress = updatedAct.status === 'done' ? 100 : updatedAct.status === 'doing' ? (typeof updatedAct.progress === 'number' ? updatedAct.progress : 50) : (typeof updatedAct.progress === 'number' ? updatedAct.progress : 0);
    await db.run(
      `UPDATE activities SET title = ?, description = ?, startDate = ?, endDate = ?, status = ?, username = ?, assignedBy = ?, priority = ?, progress = ?, teamId = ?, completedAt = ?
       WHERE id = ?`,
      [
        updatedAct.title,
        updatedAct.description,
        updatedAct.startDate,
        updatedAct.endDate,
        updatedAct.status,
        updatedAct.username,
        updatedAct.assignedBy || null,
        updatedAct.priority,
        progress,
        updatedAct.teamId || null,
        updatedAct.completedAt || null,
        updatedAct.id,
      ]
    );
    await broadcastActivities();
  });

  socket.on('activity:delete', async (id: string) => {
    await db.run('DELETE FROM activities WHERE id = ?', [id]);
    await broadcastActivities();
  });

  socket.on('activity:clearUser', async (username: string) => {
    await db.run('DELETE FROM activities WHERE LOWER(username) = LOWER(?)', [username]);
    await broadcastActivities();
  });

  socket.on('activity:clearTeam', async (teamId: string) => {
    await db.run('DELETE FROM activities WHERE teamId = ?', [teamId]);
    await broadcastActivities();
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

  socket.on('user:login', async (payload: { username: string; fullName?: string } | string) => {
    const username = await canonicalUsername(typeof payload === 'string' ? payload : payload.username);
    const fullName = typeof payload === 'string' ? undefined : payload.fullName;
    // Role is decided server-side: a login never grants or changes it (admins are
    // made through user:create or the database), apart from the built-in "admin".
    const role = username.toLowerCase() === 'admin' ? 'admin' : 'user';
    const lastLogin = new Date().toISOString();

    await db.run(
      `INSERT INTO users (username, fullName, role, lastLogin) VALUES (?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET
         fullName = COALESCE(excluded.fullName, users.fullName),
         lastLogin = excluded.lastLogin`,
      [username, fullName || null, role, lastLogin]
    );
    await ensureAdminPasswords();
    await broadcastUsers();
  });

  socket.on('user:create', async (payload: { username: string; fullName: string; role: 'admin' | 'user'; password?: string }) => {
    const { fullName } = payload;
    const role = payload.role === 'admin' ? 'admin' : 'user';
    const username = await canonicalUsername(payload.username);
    const lastLogin = new Date().toISOString();
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (role === 'admin' && password.length < MIN_PASSWORD_LENGTH) return;
    const passwordHash = role === 'admin' ? await hashPassword(password) : null;
    await db.run(
      `INSERT INTO users (username, fullName, role, lastLogin, passwordHash) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET fullName = excluded.fullName, role = excluded.role,
         passwordHash = COALESCE(excluded.passwordHash, users.passwordHash)`,
      [username, fullName, role, lastLogin, passwordHash]
    );
    await ensureAdminPasswords();
    await broadcastUsers();
  });

  socket.on('user:delete', async (username: string) => {
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
    await db.run('DELETE FROM teams WHERE id = ?', [teamId]);
    await db.run('DELETE FROM activities WHERE teamId = ?', [teamId]);
    await broadcastTeams();
    await broadcastActivities();
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
  });
}).catch((err) => {
  console.error('Failed to initialize SQLite database:', err);
});
