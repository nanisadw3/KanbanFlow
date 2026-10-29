import type { Database } from 'sqlite';
import { ROLE_MANAGER } from './roles.ts';

// Announcements shown as a banner to everyone. Two kinds:
//  - 'normal': any administrator can publish one; it disappears by itself after the chosen time.
//  - 'maintenance': only the role manager ("Inaki"); it stays until someone ends it. There is at most one.
// They are informative, not a lock: people can keep working.
export type NoticeKind = 'normal' | 'maintenance';

export const MAX_NOTICE_LENGTH = 500;
// How long a normal notice stays up (minutes) and the default.
export const NOTICE_MINUTES = [15, 60, 240, 1440] as const;
export const DEFAULT_NOTICE_MINUTES = 60;
export const DEFAULT_MAINTENANCE =
  'Vamos a agregar una nueva funcionalidad. KanbanFlow estará en mantenimiento por un momento y puede que no esté disponible unos minutos.';

export interface Notice {
  id: string;
  kind: NoticeKind;
  message: string;
  createdAt: string;
  expiresAt: string | null; // null = until ended (maintenance)
  createdBy: string;
}

export async function ensureNoticesTable(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT,
      createdBy TEXT NOT NULL
    )
  `);
}

const isManager = (username: string) => username.toLowerCase() === ROLE_MANAGER;

// The notices that are still up (expired ones are deleted), maintenance first, then newest first.
export async function listActive(db: Database, now: Date = new Date()): Promise<Notice[]> {
  await db.run('DELETE FROM notices WHERE expiresAt IS NOT NULL AND expiresAt <= ?', [now.toISOString()]);
  return db.all<Notice[]>("SELECT * FROM notices ORDER BY CASE kind WHEN 'maintenance' THEN 0 ELSE 1 END, createdAt DESC");
}

export type PublishError = 'forbidden' | 'invalid_kind' | 'empty' | 'too_long';

// The caller has already proven to be an administrator; `by` is that username.
export async function publishNotice(
  db: Database,
  input: { by: string; kind: unknown; message: unknown; minutes?: unknown },
  now: Date = new Date()
): Promise<{ ok: true; notice: Notice } | { ok: false; error: PublishError }> {
  if (input.kind !== 'normal' && input.kind !== 'maintenance') return { ok: false, error: 'invalid_kind' };
  const kind: NoticeKind = input.kind;
  if (kind === 'maintenance' && !isManager(input.by)) return { ok: false, error: 'forbidden' };

  const text = typeof input.message === 'string' ? input.message.trim() : '';
  if (text.length > MAX_NOTICE_LENGTH) return { ok: false, error: 'too_long' };
  if (kind === 'normal' && !text) return { ok: false, error: 'empty' };

  let expiresAt: string | null = null;
  if (kind === 'normal') {
    const minutes = (NOTICE_MINUTES as readonly unknown[]).includes(input.minutes) ? (input.minutes as number) : DEFAULT_NOTICE_MINUTES;
    expiresAt = new Date(now.getTime() + minutes * 60_000).toISOString();
  } else {
    await db.run("DELETE FROM notices WHERE kind = 'maintenance'"); // a new maintenance notice replaces the old one
  }

  const notice: Notice = {
    id: 'ntc_' + Math.random().toString(36).substring(2, 11),
    kind,
    message: text || DEFAULT_MAINTENANCE,
    createdAt: now.toISOString(),
    expiresAt,
    createdBy: input.by,
  };
  await db.run(
    'INSERT INTO notices (id, kind, message, createdAt, expiresAt, createdBy) VALUES (?, ?, ?, ?, ?, ?)',
    [notice.id, notice.kind, notice.message, notice.createdAt, notice.expiresAt, notice.createdBy]
  );
  return { ok: true, notice };
}

export type EndError = 'forbidden' | 'not_found';

// Any administrator can take down a normal notice; a maintenance one only the role manager.
export async function endNotice(db: Database, input: { by: string; id: unknown }): Promise<{ ok: true } | { ok: false; error: EndError }> {
  const row = await db.get<{ kind: string }>('SELECT kind FROM notices WHERE id = ?', [typeof input.id === 'string' ? input.id : '']);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.kind === 'maintenance' && !isManager(input.by)) return { ok: false, error: 'forbidden' };
  await db.run('DELETE FROM notices WHERE id = ?', [input.id]);
  return { ok: true };
}
