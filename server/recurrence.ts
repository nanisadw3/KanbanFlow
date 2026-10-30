import type { Database } from 'sqlite';
import { createSharedTask } from './shared.ts';

// Repeating tasks. A series is one row in `recurrences` (the template and the rule) plus one
// activity per occurrence. The rule says WHICH DAY a new occurrence appears:
//   weekly / biweekly      -> a weekday, Monday (1) to Friday (5)
//   monthly / quarterly / semiannual -> a day of the month (1-31; short months use their last day)
//   yearly                 -> a day and a month
// Occurrences have a start date (the day they were generated) and no end date, so they never
// count as overdue. Dates are plain YYYY-MM-DD strings, like everywhere else in the app.
export const REPEATS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly'] as const;
export type Repeat = (typeof REPEATS)[number];

export const isRepeat = (v: unknown): v is Repeat => typeof v === 'string' && (REPEATS as readonly string[]).includes(v);

export interface Rule {
  repeat: Repeat;
  day: number;           // weekday 1-5 for weekly/biweekly, day of the month otherwise
  month: number | null;  // 1-12, only for yearly
}

const MONTH_STEP: Partial<Record<Repeat, number>> = { quarterly: 3, semiannual: 6 };

const pad = (n: number) => String(n).padStart(2, '0');
const parse = (ymd: string): [number, number, number] => {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y, m, d];
};
const fmt = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = parse(ymd);
  return fmt(new Date(Date.UTC(y, m - 1, d + days)));
}

const weekdayOf = (ymd: string): number => {
  const [y, m, d] = parse(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday ... 6 = Saturday
};

// `day` of month index `monthIndex` (0-based, may overflow into other years), clamped to the end
// of that month: day 31 in February is the 28th (or 29th).
function clampedDate(year: number, monthIndex: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay))));
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

// Turns whatever the client sent into a valid rule (out-of-range values fall back to the first
// valid one rather than producing a rule that never fires).
export function normalizeRule(repeat: Repeat, day: unknown, month: unknown): Rule {
  const weekly = repeat === 'weekly' || repeat === 'biweekly';
  return {
    repeat,
    day: weekly ? clampInt(day, 1, 5, 1) : clampInt(day, 1, 31, 1),
    month: repeat === 'yearly' ? clampInt(month, 1, 12, 1) : null,
  };
}

// The first occurrence strictly after `last` (the date of the previous one).
export function nextOccurrence(rule: Rule, last: string): string {
  const [y, m] = parse(last);
  switch (rule.repeat) {
    case 'weekly':
    case 'biweekly': {
      // Biweekly keeps at least 8 days between occurrences, so from a Monday it lands on the
      // Monday two weeks later.
      let d = addDays(last, rule.repeat === 'weekly' ? 1 : 8);
      while (weekdayOf(d) !== rule.day) d = addDays(d, 1);
      return d;
    }
    case 'monthly': {
      for (let k = 0; ; k++) {
        const c = clampedDate(y, m - 1 + k, rule.day);
        if (c > last) return c;
      }
    }
    case 'quarterly':
    case 'semiannual':
      return clampedDate(y, m - 1 + (MONTH_STEP[rule.repeat] ?? 3), rule.day);
    case 'yearly': {
      for (let k = 0; ; k++) {
        const c = clampedDate(y + k, (rule.month ?? 1) - 1, rule.day);
        if (c > last) return c;
      }
    }
  }
}

// The occurrence that should exist by `today`, or null when none is due. If several came due
// (the server was off), only the most recent one is returned instead of flooding the board.
export function dueOccurrence(rule: Rule, last: string, today: string): string | null {
  let cur = last;
  let found: string | null = null;
  for (let i = 0; i < 5000; i++) {
    const n = nextOccurrence(rule, cur);
    if (n > today) break;
    found = n;
    cur = n;
  }
  return found;
}

// "Cada semana, los lunes" — the same wording the app shows (src/taskKinds.ts describeRepeat), for emails.
const EVERY: Record<Repeat, string> = {
  weekly: 'Cada semana', biweekly: 'Cada 2 semanas', monthly: 'Cada mes',
  quarterly: 'Cada trimestre', semiannual: 'Cada semestre', yearly: 'Cada año',
};
const WEEKDAY_NAMES = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function repeatLabel(rule: Rule): string {
  const every = EVERY[rule.repeat];
  if (rule.repeat === 'weekly' || rule.repeat === 'biweekly') return `${every}, los ${WEEKDAY_NAMES[rule.day] ?? 'lunes'}`;
  if (rule.repeat === 'yearly') return `${every}, el ${rule.day} de ${MONTH_NAMES[(rule.month ?? 1) - 1]}`;
  return `${every}, el día ${rule.day}`;
}

export async function ensureRecurrenceTable(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS recurrences (
      id TEXT PRIMARY KEY,
      repeat TEXT NOT NULL,
      day INTEGER NOT NULL,
      month INTEGER,
      lastDate TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL,
      username TEXT NOT NULL,
      assignedBy TEXT,
      teamId TEXT
    )
  `);
  // A shared series keeps WHO takes part (JSON array of usernames); NULL for an ordinary repeating task.
  try { await db.exec('ALTER TABLE recurrences ADD COLUMN participants TEXT'); } catch { /* already there */ }
}

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).substring(2, 11)}`;

// Stops a series: no more occurrences, and the ones that exist become ordinary tasks (a shared
// occurrence stays shared, it just stops being part of a series).
export async function stopSeries(db: Database, seriesId: string): Promise<void> {
  await db.run('DELETE FROM recurrences WHERE id = ?', [seriesId]);
  await db.run("UPDATE activities SET kind = CASE WHEN sharedId IS NOT NULL THEN 'shared' ELSE 'single' END, seriesId = NULL WHERE seriesId = ?", [seriesId]);
}

// Drops the series of a deleted team (all of them) or of a user whose board was cleared (only the
// ordinary ones: a shared series belongs to all its participants, not to one board).
export async function dropSeriesWhere(db: Database, column: 'username' | 'teamId', value: string): Promise<void> {
  const clause = column === 'username' ? 'LOWER(username) = LOWER(?) AND participants IS NULL' : 'teamId = ?';
  const rows = await db.all<{ id: string }[]>(`SELECT id FROM recurrences WHERE ${clause}`, [value]);
  for (const r of rows) await stopSeries(db, r.id);
}

const parseParticipants = (raw: string | null): string[] | null => {
  if (raw === null || raw === undefined) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
};

// The people the NEXT occurrences of a shared series are created for (null = not a shared series).
export async function setSeriesParticipants(db: Database, seriesId: string, usernames: string[] | null): Promise<void> {
  await db.run('UPDATE recurrences SET participants = ? WHERE id = ?', [usernames === null ? null : JSON.stringify(usernames), seriesId]);
}

export type RuleChangeError = 'not_found' | 'no_series' | 'invalid_repeat' | 'forbidden';

// Changes WHEN a series repeats (frequency + day), from any of its occurrences. The next occurrence is
// counted from `today`, so moving the day doesn't instantly create one for a day that already passed
// this week/month. Occurrences already created keep their dates. A shared series (a "rutina") can only be
// changed by one of its participants or an admin.
export async function changeSeriesRule(
  db: Database,
  input: { id?: unknown; by?: unknown; repeat?: unknown; repeatDay?: unknown; repeatMonth?: unknown },
  today: string
): Promise<{ ok: true; seriesId: string } | { ok: false; error: RuleChangeError }> {
  const row = await db.get<{ seriesId: string | null }>('SELECT seriesId FROM activities WHERE id = ?', [typeof input.id === 'string' ? input.id : '']);
  if (!row) return { ok: false, error: 'not_found' };
  if (!row.seriesId) return { ok: false, error: 'no_series' };
  if (!isRepeat(input.repeat)) return { ok: false, error: 'invalid_repeat' };

  const actor = await db.get<{ username: string; role: string | null }>('SELECT username, role FROM users WHERE username = ? COLLATE NOCASE', [typeof input.by === 'string' ? input.by : '']);
  if (!actor) return { ok: false, error: 'forbidden' };
  const series = await db.get<{ participants: string | null }>('SELECT participants FROM recurrences WHERE id = ?', [row.seriesId]);
  if (!series) return { ok: false, error: 'no_series' };
  const people = parseParticipants(series.participants);
  const isAdmin = actor.role === 'admin' || actor.username.toLowerCase() === 'admin';
  if (people && !isAdmin && !people.some(p => p.toLowerCase() === actor.username.toLowerCase())) return { ok: false, error: 'forbidden' };

  const rule = normalizeRule(input.repeat, input.repeatDay, input.repeatMonth);
  await db.run('UPDATE recurrences SET repeat = ?, day = ?, month = ?, lastDate = ? WHERE id = ?', [rule.repeat, rule.day, rule.month, today, row.seriesId]);
  return { ok: true, seriesId: row.seriesId };
}

// A deleted user leaves every shared series (and one with nobody left stops).
export async function removeUserFromSeries(db: Database, username: string): Promise<void> {
  const rows = await db.all<{ id: string; username: string; participants: string | null }[]>(
    'SELECT id, username, participants FROM recurrences WHERE participants IS NOT NULL'
  );
  const lower = username.toLowerCase();
  for (const r of rows) {
    const people = parseParticipants(r.participants) ?? [];
    if (!people.some(p => p.toLowerCase() === lower)) continue;
    const rest = people.filter(p => p.toLowerCase() !== lower);
    if (rest.length === 0) { await stopSeries(db, r.id); continue; }
    await db.run('UPDATE recurrences SET participants = ?, username = CASE WHEN LOWER(username) = ? THEN ? ELSE username END WHERE id = ?', [JSON.stringify(rest), lower, rest[0], r.id]);
  }
}

// `startDate` is the day the first occurrence was created; the next one is computed from it.
export async function createSeries(
  db: Database,
  t: {
    rule: Rule; title: string; description: string; priority: string; username: string; assignedBy: string | null; teamId: string | null;
    startDate: string;
    participants?: string[] | null; // set = a SHARED series: each occurrence is created for all of them
  }
): Promise<string> {
  const id = newId('ser');
  await db.run(
    `INSERT INTO recurrences (id, repeat, day, month, lastDate, title, description, priority, username, assignedBy, teamId, participants)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, t.rule.repeat, t.rule.day, t.rule.month, t.startDate, t.title, t.description, t.priority, t.username, t.assignedBy, t.teamId,
      t.participants ? JSON.stringify(t.participants) : null]
  );
  return id;
}

interface SeriesRow {
  id: string; repeat: string; day: number; month: number | null; lastDate: string; title: string; description: string;
  priority: string; username: string; assignedBy: string | null; teamId: string | null; participants: string | null;
}

// Creates the occurrences that came due. Returns how many tasks were created.
export async function runRecurrences(db: Database, today: string, now: Date = new Date()): Promise<number> {
  const rows = await db.all<SeriesRow[]>('SELECT * FROM recurrences');
  let created = 0;
  for (const s of rows) {
    const people = parseParticipants(s.participants);
    // A shared series needs at least one participant who still exists (and, on a team, is still a member).
    let valid: string[] = [];
    if (people) {
      const known = (await db.all<{ username: string }[]>('SELECT username FROM users')).map(u => u.username);
      let allowed = known;
      if (s.teamId) {
        const team = await db.get<{ memberUsernames: string }>('SELECT memberUsernames FROM teams WHERE id = ?', [s.teamId]);
        const members = new Set((JSON.parse(team?.memberUsernames || '[]') as string[]).map(m => m.toLowerCase()));
        allowed = known.filter(u => members.has(u.toLowerCase()));
      }
      const byLower = new Map(allowed.map(u => [u.toLowerCase(), u]));
      valid = [...new Set(people.map(p => byLower.get(p.toLowerCase())).filter((u): u is string => !!u))];
    }
    const owner = people ? valid.length > 0 : !!(await db.get('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE', [s.username]));
    if (!owner || !isRepeat(s.repeat)) {
      await stopSeries(db, s.id);
      continue;
    }
    const due = dueOccurrence(normalizeRule(s.repeat, s.day, s.month), s.lastDate, today);
    if (!due) continue;
    if (people) {
      // One fresh shared task for everyone: 0% each, a new (empty) comment thread. No email: that only
      // goes out when the series is created.
      await createSharedTask(db, {
        title: s.title, description: s.description, startDate: due, endDate: '', priority: s.priority as 'alta' | 'media' | 'baja',
        usernames: valid, assignedBy: s.assignedBy ?? '', teamId: s.teamId,
      }, now, s.id);
      await db.run('UPDATE recurrences SET lastDate = ? WHERE id = ?', [due, s.id]);
      created += 1;
      continue;
    }
    await db.run(
      `INSERT INTO activities (id, title, description, startDate, endDate, status, username, createdAt, assignedBy, priority, progress, teamId, kind, seriesId)
       VALUES (?, ?, ?, ?, '', 'todo', ?, ?, ?, ?, 0, ?, 'recurring', ?)`,
      [newId('act'), s.title, s.description, due, s.username, now.toISOString(), s.assignedBy, s.priority, s.teamId, s.id]
    );
    await db.run('UPDATE recurrences SET lastDate = ? WHERE id = ?', [due, s.id]);
    created += 1;
  }
  return created;
}
