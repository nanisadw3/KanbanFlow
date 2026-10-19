import type { Database } from 'sqlite';
import { overdueMessage, type Mailer } from './mailer.ts';

export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Milliseconds until the next local midnight — the moment a task whose end date is "today"
// becomes overdue. Recomputed each time (never a fixed 24h) so DST changes don't drift it.
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

interface OverdueRow {
  id: string;
  title: string;
  description: string;
  endDate: string;
  priority: string;
  email: string | null;
  name: string | null;
}

// Sends one "overdue" email per task and stamps overdueNotifiedAt. A task is only
// stamped after a successful send, so send failures and users without an email are
// retried on the next pass.
export async function runOverdueCheck(db: Database, mailer: Mailer, today: string): Promise<number> {
  if (!mailer.enabled) return 0;
  const rows = await db.all<OverdueRow[]>(
    `SELECT a.id, a.title, a.description, a.endDate, a.priority, u.email, COALESCE(u.fullName, u.username) AS name
       FROM activities a
       LEFT JOIN users u ON u.username = a.username COLLATE NOCASE
      WHERE a.endDate != '' AND a.endDate < ?
        AND a.status NOT IN ('done', 'cancelled')
        AND a.archived = 0
        AND a.overdueNotifiedAt IS NULL`,
    [today]
  );
  let sent = 0;
  for (const row of rows) {
    if (!row.email) continue;
    const { subject, text, html } = overdueMessage(row, { name: row.name ?? undefined, today, appUrl: process.env.APP_URL });
    if (!(await mailer.send(row.email, subject, text, html))) continue;
    await db.run('UPDATE activities SET overdueNotifiedAt = ? WHERE id = ?', [new Date().toISOString(), row.id]);
    sent += 1;
  }
  return sent;
}

// Runs overdue passes without overlapping. A call that arrives while a pass is running
// returns 0 immediately but asks for ONE more pass right after it, so a task created or
// changed mid-pass is still notified now instead of at the next clock tick; no row is
// stamped before its send succeeds, so a repeat can never double-send.
export function createOverdueChecker(db: Database, mailer: Mailer | (() => Mailer), getToday: () => string = localToday) {
  let running = false;
  let rerun = false;
  return async (): Promise<number> => {
    if (running) {
      rerun = true;
      return 0;
    }
    running = true;
    let total = 0;
    try {
      do {
        rerun = false;
        total += await runOverdueCheck(db, typeof mailer === 'function' ? mailer() : mailer, getToday());
      } while (rerun);
      return total;
    } finally {
      running = false;
    }
  };
}
