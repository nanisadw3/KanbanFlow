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
