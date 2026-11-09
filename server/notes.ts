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
