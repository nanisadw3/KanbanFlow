import type { Database } from 'sqlite';

// Shared tasks: ONE row per participant (so it lands on each person's board with their own status
// and progress), all linked by `sharedId`. Comments hang from the same `sharedId`.
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_COMMENT_LENGTH = 1000;

export interface SharedInput {
  title?: unknown;
  description?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  priority?: unknown;
  usernames?: unknown;
  assignedBy?: unknown;
  teamId?: unknown;
}

export interface ValidShared {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  priority: 'alta' | 'media' | 'baja';
  usernames: string[];   // canonical spelling, no duplicates
  assignedBy: string;
  teamId: string | null;
}

export type SharedError = 'invalid_title' | 'invalid_dates' | 'no_participants';

// `known` are the usernames that exist (canonical spelling); anything else is dropped.
export function validateShared(input: SharedInput, known: string[]): { ok: true; task: ValidShared } | { ok: false; error: SharedError } {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return { ok: false, error: 'invalid_title' };
  const startDate = typeof input.startDate === 'string' ? input.startDate : '';
  const endDate = typeof input.endDate === 'string' ? input.endDate : '';
  if (!YMD.test(startDate) || !YMD.test(endDate)) return { ok: false, error: 'invalid_dates' };

  const byLower = new Map(known.map(u => [u.toLowerCase(), u]));
  const requested = Array.isArray(input.usernames) ? input.usernames : [];
  const usernames = [...new Set(requested.map(u => byLower.get(String(u).toLowerCase())).filter((u): u is string => !!u))];
  if (usernames.length === 0) return { ok: false, error: 'no_participants' };

  return {
    ok: true,
    task: {
      title,
      description: typeof input.description === 'string' ? input.description : '',
      startDate,
      endDate,
      priority: input.priority === 'alta' || input.priority === 'baja' ? input.priority : 'media',
      usernames,
      assignedBy: typeof input.assignedBy === 'string' ? input.assignedBy : '',
      teamId: typeof input.teamId === 'string' && input.teamId ? input.teamId : null,
    },
  };
}

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).substring(2, 11)}`;

// Inserts one activity per participant. The creator's own copy carries no "assigned by".
export async function createSharedTask(db: Database, t: ValidShared, now: Date = new Date(), seriesId: string | null = null): Promise<{ sharedId: string; ids: string[] }> {
  const sharedId = newId('shr');
  const ids: string[] = [];
  for (const username of t.usernames) {
    const id = newId('act');
    ids.push(id);
    const mine = !!t.assignedBy && username.toLowerCase() === t.assignedBy.toLowerCase();
    await db.run(
      `INSERT INTO activities (id, title, description, startDate, endDate, status, username, createdAt, assignedBy, priority, progress, teamId, kind, sharedId, seriesId)
       VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, 0, ?, 'shared', ?, ?)`,
      [id, t.title, t.description, t.startDate, t.endDate, username, now.toISOString(), mine ? null : (t.assignedBy || null), t.priority, t.teamId, sharedId, seriesId]
    );
  }
  return { sharedId, ids };
}

// Title, description, dates and priority are the task itself, so an edit reaches every copy.
// Status and progress stay per person.
export async function syncSharedFields(
  db: Database,
  sharedId: string,
  f: { title: string; description: string; startDate: string; endDate: string; priority: string }
): Promise<void> {
  await db.run(
    `UPDATE activities SET title = ?, description = ?, startDate = ?, endDate = ?, priority = ?,
       overdueNotifiedAt = CASE WHEN endDate != ? THEN NULL ELSE overdueNotifiedAt END
     WHERE sharedId = ?`,
    [f.title, f.description, f.startDate, f.endDate, f.priority, f.endDate, sharedId]
  );
}

export async function ensureCommentsTable(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      sharedId TEXT NOT NULL,
      username TEXT NOT NULL,
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);
}

// When each person last looked at a shared task's comments. Used to count what is new for them.
export async function ensureCommentReadsTable(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS comment_reads (
      username TEXT NOT NULL COLLATE NOCASE,
      sharedId TEXT NOT NULL,
      lastReadAt TEXT NOT NULL,
      PRIMARY KEY (username, sharedId)
    )
  `);
}

// Comments of a shared task nobody has a copy of any more would be unreachable: drop them (and the
// read marks that pointed at them).
export async function pruneComments(db: Database): Promise<void> {
  await db.run('DELETE FROM comments WHERE sharedId NOT IN (SELECT sharedId FROM activities WHERE sharedId IS NOT NULL)');
  await db.run('DELETE FROM comment_reads WHERE sharedId NOT IN (SELECT sharedId FROM activities WHERE sharedId IS NOT NULL)');
}

export async function markCommentsRead(
  db: Database,
  input: { username?: unknown; sharedId?: unknown },
  now: Date = new Date()
): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
  const sharedId = typeof input.sharedId === 'string' ? input.sharedId : '';
  const user = await db.get<{ username: string }>('SELECT username FROM users WHERE username = ? COLLATE NOCASE', [typeof input.username === 'string' ? input.username : '']);
  const exists = await db.get('SELECT 1 FROM activities WHERE sharedId = ?', [sharedId]);
  if (!user || !exists) return { ok: false, error: 'not_found' };
  await db.run(
    `INSERT INTO comment_reads (username, sharedId, lastReadAt) VALUES (?, ?, ?)
     ON CONFLICT(username, sharedId) DO UPDATE SET lastReadAt = excluded.lastReadAt`,
    [user.username, sharedId, now.toISOString()]
  );
  return { ok: true };
}

// Comments by OTHER people that `username` hasn't seen yet: those after their last read mark, or, if
// they never opened the task, after their copy of it was created (comments from before they were
// part of it are not "new" for them).
export async function countUnread(db: Database, username: string, sharedId: string): Promise<number> {
  const row = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM comments c
      WHERE c.sharedId = ? AND LOWER(c.username) != LOWER(?)
        AND c.createdAt > COALESCE(
          (SELECT lastReadAt FROM comment_reads r WHERE r.sharedId = c.sharedId AND r.username = ? COLLATE NOCASE),
          (SELECT createdAt FROM activities a WHERE a.sharedId = c.sharedId AND a.username = ? COLLATE NOCASE LIMIT 1),
          ''
        )`,
    [sharedId, username, username, username]
  );
  return row?.n ?? 0;
}

// Who to email about a comment that was JUST added: the other participants (with an email) for whom
// it is the first unread one. Later comments only raise the badge, so a busy thread never floods inboxes.
export async function commentRecipients(
  db: Database,
  sharedId: string,
  author: string
): Promise<{ username: string; fullName: string | null; email: string }[]> {
  const people = await db.all<{ username: string; fullName: string | null; email: string | null }[]>(
    `SELECT DISTINCT u.username, u.fullName, u.email FROM activities a
       JOIN users u ON u.username = a.username COLLATE NOCASE
      WHERE a.sharedId = ? AND LOWER(u.username) != LOWER(?)`,
    [sharedId, author]
  );
  const out: { username: string; fullName: string | null; email: string }[] = [];
  for (const p of people) {
    if (!p.email) continue;
    if ((await countUnread(db, p.username, sharedId)) === 1) out.push({ username: p.username, fullName: p.fullName, email: p.email });
  }
  return out;
}

// Only someone who has a copy of the task (or an admin) can comment on it.
export async function addComment(
  db: Database,
  input: { sharedId?: unknown; username?: unknown; text?: unknown },
  now: Date = new Date()
): Promise<{ ok: true } | { ok: false; error: 'invalid_comment' | 'not_found' | 'forbidden' }> {
  const sharedId = typeof input.sharedId === 'string' ? input.sharedId : '';
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_COMMENT_LENGTH) : '';
  if (!text) return { ok: false, error: 'invalid_comment' };
  const author = await db.get<{ username: string; role: string | null }>(
    'SELECT username, role FROM users WHERE username = ? COLLATE NOCASE', [typeof input.username === 'string' ? input.username : '']
  );
  if (!author) return { ok: false, error: 'not_found' };
  const copies = await db.all<{ username: string }[]>('SELECT username FROM activities WHERE sharedId = ?', [sharedId]);
  if (copies.length === 0) return { ok: false, error: 'not_found' };
  const isAdmin = author.role === 'admin' || author.username.toLowerCase() === 'admin';
  if (!isAdmin && !copies.some(c => c.username.toLowerCase() === author.username.toLowerCase())) return { ok: false, error: 'forbidden' };
  await db.run('INSERT INTO comments (id, sharedId, username, text, createdAt) VALUES (?, ?, ?, ?, ?)', [newId('cmt'), sharedId, author.username, text, now.toISOString()]);
  return { ok: true };
}

export interface Recipient {
  username: string;
  fullName: string | null;
  email: string;
  participant: boolean;
}

// Everyone who should hear about a new shared task: the participants plus every admin, once each
// (by email), skipping the creator and anyone without an email.
export function sharedRecipients(
  people: { username: string; fullName: string | null; email: string | null; role: string | null }[],
  participants: string[],
  creator: string
): Recipient[] {
  const inTask = new Set(participants.map(p => p.toLowerCase()));
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const p of people) {
    const isAdmin = p.role === 'admin' || p.username.toLowerCase() === 'admin';
    const participant = inTask.has(p.username.toLowerCase());
    if (!participant && !isAdmin) continue;
    if (p.username.toLowerCase() === creator.toLowerCase()) continue;
    const email = (p.email ?? '').trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push({ username: p.username, fullName: p.fullName, email, participant });
  }
  return out;
}

// ── Changing who is on a shared task ──────────────────────────────────────────────────────────

export type ParticipantsError = 'not_found' | 'no_participants' | 'forbidden';

// Adds a copy for each new person (todo, 0%) and deletes the copy of each person taken off. Someone
// removed loses their copy and progress; the comments stay. Only a participant or an admin may do it,
// and on a team task only team members can be on it.
export async function setParticipants(
  db: Database,
  input: { sharedId?: unknown; usernames?: unknown; by?: unknown },
  now: Date = new Date()
): Promise<
  | { ok: true; added: string[]; removed: string[]; task: { title: string; description: string; endDate: string; priority: string }; all: string[]; by: string }
  | { ok: false; error: ParticipantsError }
> {
  const sharedId = typeof input.sharedId === 'string' ? input.sharedId : '';
  const copies = await db.all<{ id: string; username: string; title: string; description: string; startDate: string; endDate: string; priority: string; teamId: string | null; seriesId: string | null }[]>(
    'SELECT id, username, title, description, startDate, endDate, priority, teamId, seriesId FROM activities WHERE sharedId = ?', [sharedId]
  );
  if (copies.length === 0) return { ok: false, error: 'not_found' };

  const actor = await db.get<{ username: string; role: string | null }>('SELECT username, role FROM users WHERE username = ? COLLATE NOCASE', [typeof input.by === 'string' ? input.by : '']);
  const isAdmin = !!actor && (actor.role === 'admin' || actor.username.toLowerCase() === 'admin');
  if (!actor || (!isAdmin && !copies.some(c => c.username.toLowerCase() === actor.username.toLowerCase()))) return { ok: false, error: 'forbidden' };

  const template = copies[0];
  let known = (await db.all<{ username: string }[]>('SELECT username FROM users')).map(u => u.username);
  if (template.teamId) {
    const team = await db.get<{ memberUsernames: string }>('SELECT memberUsernames FROM teams WHERE id = ?', [template.teamId]);
    const members = new Set((JSON.parse(team?.memberUsernames || '[]') as string[]).map(m => m.toLowerCase()));
    // people already on the task stay valid even if they are no longer in the team
    known = known.filter(u => members.has(u.toLowerCase()) || copies.some(c => c.username.toLowerCase() === u.toLowerCase()));
  }
  const byLower = new Map(known.map(u => [u.toLowerCase(), u]));
  const requested = Array.isArray(input.usernames) ? input.usernames : [];
  const desired = [...new Set(requested.map(u => byLower.get(String(u).toLowerCase())).filter((u): u is string => !!u))];
  if (desired.length === 0) return { ok: false, error: 'no_participants' };

  const desiredLower = new Set(desired.map(u => u.toLowerCase()));
  const currentLower = new Set(copies.map(c => c.username.toLowerCase()));
  const removedCopies = copies.filter(c => !desiredLower.has(c.username.toLowerCase()));
  const added = desired.filter(u => !currentLower.has(u.toLowerCase()));

  for (const c of removedCopies) {
    await db.run('DELETE FROM activities WHERE id = ?', [c.id]);
    await db.run('DELETE FROM comment_reads WHERE sharedId = ? AND username = ? COLLATE NOCASE', [sharedId, c.username]);
  }
  for (const username of added) {
    const mine = username.toLowerCase() === actor.username.toLowerCase();
    await db.run(
      `INSERT INTO activities (id, title, description, startDate, endDate, status, username, createdAt, assignedBy, priority, progress, teamId, kind, sharedId, seriesId)
       VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, 0, ?, 'shared', ?, ?)`,
      [newId('act'), template.title, template.description, template.startDate, template.endDate, username, now.toISOString(), mine ? null : actor.username, template.priority, template.teamId, sharedId, template.seriesId]
    );
  }
  // On a repeating shared task the next cycles use the new list of people.
  if (template.seriesId) {
    await db.run('UPDATE recurrences SET participants = ? WHERE id = ?', [JSON.stringify(desired), template.seriesId]);
  }
  return {
    ok: true,
    added,
    removed: removedCopies.map(c => c.username),
    task: { title: template.title, description: template.description, endDate: template.endDate, priority: template.priority },
    all: desired,
    by: actor.username,
  };
}
