import type { Database } from 'sqlite';
import { ROLE_MANAGER } from './roles.ts';
import { getSetting, setSetting } from './settings.ts';

// A notice that KanbanFlow is about to get a new feature and will be under maintenance. Only the
// role manager ("Inaki") can start or end it. It is informative, not a lock: people can keep working.
// It is stored in `settings` so someone who connects later still sees it.
const KEY = 'maintenance_notice';
export const MAX_NOTICE_LENGTH = 500;
export const DEFAULT_NOTICE =
  'Vamos a agregar una nueva funcionalidad. KanbanFlow estará en mantenimiento por un momento y puede que no esté disponible unos minutos.';

export interface MaintenanceNotice {
  message: string;
  startedAt: string;
  by: string;
}

export async function getNotice(db: Database): Promise<MaintenanceNotice | null> {
  const raw = await getSetting(db, KEY);
  if (!raw) return null;
  try {
    const n = JSON.parse(raw);
    return typeof n?.message === 'string' ? { message: n.message, startedAt: String(n.startedAt ?? ''), by: String(n.by ?? '') } : null;
  } catch {
    return null;
  }
}

export type NoticeError = 'forbidden' | 'too_long';

export async function startNotice(
  db: Database,
  by: string,
  message: unknown,
  now: Date = new Date()
): Promise<{ ok: true; notice: MaintenanceNotice } | { ok: false; error: NoticeError }> {
  if (by.toLowerCase() !== ROLE_MANAGER) return { ok: false, error: 'forbidden' };
  const text = typeof message === 'string' ? message.trim() : '';
  if (text.length > MAX_NOTICE_LENGTH) return { ok: false, error: 'too_long' };
  const notice = { message: text || DEFAULT_NOTICE, startedAt: now.toISOString(), by };
  await setSetting(db, KEY, JSON.stringify(notice));
  return { ok: true, notice };
}

export async function endNotice(db: Database, by: string): Promise<{ ok: true } | { ok: false; error: NoticeError }> {
  if (by.toLowerCase() !== ROLE_MANAGER) return { ok: false, error: 'forbidden' };
  await db.run('DELETE FROM settings WHERE key = ?', [KEY]);
  return { ok: true };
}
