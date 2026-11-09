// Timeline notes on INDIVIDUAL and REPEATING tasks: a dated log of what happened with the task,
// written by whoever owns it (or staff: an admin or a power user). Shared tasks keep their chat (`comments`); this is the
// single-person version. Notes hang from the activity id, so each occurrence of a repeating task
// has its own timeline.
import type { Database } from 'sqlite';
import { isStaff } from './roles.ts';

export const MAX_NOTE_LENGTH = 1000;
const newId = () => `note_${Math.random().toString(36).substring(2, 11)}`;

export async function ensureNotesTable(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS task_notes (
      id TEXT PRIMARY KEY,
      activityId TEXT NOT NULL,
      username TEXT NOT NULL,
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);
}

export type NoteError = 'invalid_comment' | 'not_found' | 'forbidden' | 'not_supported';

// Only the task's owner or staff (admin / power user) may write; shared tasks have their own chat.
export async function addNote(
  db: Database,
  input: { activityId?: unknown; username?: unknown; text?: unknown },
  now: Date = new Date()
): Promise<{ ok: true } | { ok: false; error: NoteError }> {
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_NOTE_LENGTH) : '';
  if (!text) return { ok: false, error: 'invalid_comment' };
  const author = await db.get<{ username: string; role: string | null }>(
    'SELECT username, role FROM users WHERE username = ? COLLATE NOCASE', [typeof input.username === 'string' ? input.username : '']
  );
  const task = await db.get<{ username: string; kind: string | null }>(
    'SELECT username, kind FROM activities WHERE id = ?', [typeof input.activityId === 'string' ? input.activityId : '']
  );
  if (!author || !task) return { ok: false, error: 'not_found' };
  if (task.kind === 'shared') return { ok: false, error: 'not_supported' };
  const staff = isStaff(author);
  if (!staff && author.username.toLowerCase() !== task.username.toLowerCase()) return { ok: false, error: 'forbidden' };
  await db.run('INSERT INTO task_notes (id, activityId, username, text, createdAt) VALUES (?, ?, ?, ?, ?)', [newId(), String(input.activityId), author.username, text, now.toISOString()]);
  return { ok: true };
}

// A note can be removed by its author or by staff.
export async function deleteNote(
  db: Database,
  input: { id?: unknown; username?: unknown }
): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'forbidden' }> {
  const note = await db.get<{ username: string }>('SELECT username FROM task_notes WHERE id = ?', [typeof input.id === 'string' ? input.id : '']);
  const who = await db.get<{ username: string; role: string | null }>('SELECT username, role FROM users WHERE username = ? COLLATE NOCASE', [typeof input.username === 'string' ? input.username : '']);
  if (!note || !who) return { ok: false, error: 'not_found' };
  const staff = isStaff(who);
  if (!staff && who.username.toLowerCase() !== note.username.toLowerCase()) return { ok: false, error: 'forbidden' };
  await db.run('DELETE FROM task_notes WHERE id = ?', [input.id]);
  return { ok: true };
}

// Notes of a task that no longer exists would be unreachable.
export async function pruneNotes(db: Database): Promise<void> {
  await db.run('DELETE FROM task_notes WHERE activityId NOT IN (SELECT id FROM activities)');
}

// A rename carries the author's name along.
export async function renameNoteAuthor(db: Database, from: string, to: string): Promise<void> {
  await db.run('UPDATE task_notes SET username = ? WHERE LOWER(username) = LOWER(?)', [to, from]);
}

// ── Telling the owner about a note somebody else left ─────────────────────────────────────────

export interface NoteRecipient {
  task: { title: string; description: string; endDate: string; priority: string; repeating: boolean };
  owner: { username: string; fullName: string | null; email: string };
  authorName: string;
}

// The person to e-mail about a note that was JUST added: the task's owner, when somebody else wrote it
// and the owner has an address. Null when there's nobody to tell.
export async function noteRecipient(db: Database, activityId: string, author: string): Promise<NoteRecipient | null> {
  const task = await db.get<{ title: string; description: string | null; endDate: string | null; priority: string | null; seriesId: string | null; username: string }>(
    'SELECT title, description, endDate, priority, seriesId, username FROM activities WHERE id = ?', [activityId]
  );
  if (!task) return null;
  const authorRow = await db.get<{ username: string; fullName: string | null }>('SELECT username, fullName FROM users WHERE username = ? COLLATE NOCASE', [author]);
  if (!authorRow || authorRow.username.toLowerCase() === task.username.toLowerCase()) return null;
  const owner = await db.get<{ username: string; fullName: string | null; email: string | null }>('SELECT username, fullName, email FROM users WHERE username = ? COLLATE NOCASE', [task.username]);
  if (!owner || !owner.email) return null;
  return {
    task: { title: task.title, description: task.description ?? '', endDate: task.endDate ?? '', priority: task.priority ?? 'media', repeating: !!task.seriesId },
    owner: { username: owner.username, fullName: owner.fullName, email: owner.email },
    authorName: authorRow.fullName || authorRow.username,
  };
}

// At most one e-mail per task every `windowMs` (default 30 min), so a run of notes never floods the inbox.
// Kept in memory: after a restart the first note simply e-mails again.
export function createNoteThrottle(windowMs = 30 * 60 * 1000) {
  const last = new Map<string, number>();
  return {
    allow(activityId: string, now: number = Date.now()): boolean {
      const before = last.get(activityId);
      if (before !== undefined && now - before < windowMs) return false;
      last.set(activityId, now);
      return true;
    },
  };
}
