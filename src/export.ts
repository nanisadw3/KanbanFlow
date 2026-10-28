import type { Activity, User, Team } from './db';
import { isOverdue, daysOverdue } from './dates';

// Pure data behind the Excel export (tested in server/export.test.ts): the tasks of every user,
// grouped per person, with Spanish labels and the overdue flag/days computed. By default only the
// NON-archived ones; `includeArchived` adds the archived ones too (and an "Archivada" column).

const STATUS_LABEL: Record<Activity['status'], string> = { todo: 'Por hacer', doing: 'En curso', done: 'Hecha', cancelled: 'Cancelada' };
const STATUS_ORDER: Record<Activity['status'], number> = { todo: 0, doing: 1, done: 2, cancelled: 3 };
const PRIORITY_LABEL: Record<Activity['priority'], string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };

export interface ExportTaskRow {
  username: string;
  userName: string;       // full name (or username)
  email: string;
  title: string;
  description: string;
  status: string;         // label
  priority: string;       // label
  progress: number | null;
  start: string;          // YYYY-MM-DD
  end: string;            // YYYY-MM-DD
  overdue: boolean;
  overdueDays: number;
  assignedBy: string;
  scope: string;          // team name, or "Personal"
  createdAt: string;      // ISO
  completedAt: string;    // ISO or ''
  archived: boolean;
}

export interface SummaryRow {
  username: string;
  userName: string;
  email: string;
  todo: number;
  doing: number;
  done: number;
  cancelled: number;
  total: number;
  overdue: number;
  archived: number;       // how many of their exported tasks are archived (0 unless archived ones are included)
  rate: number;           // % of their exported tasks that are done
}

export interface UserSheet {
  username: string;
  userName: string;
  sheetName: string;
  rows: ExportTaskRow[];
}

export interface ExportData {
  summary: SummaryRow[];
  tasks: ExportTaskRow[];
  byUser: UserSheet[];
  includesArchived: boolean; // the archived tasks were asked for: the sheets get an "Archivada" column
}

// Excel sheet names: max 31 chars, none of \ / ? * [ ] :, unique case-insensitively.
export function safeSheetName(name: string, used: Set<string>, reserved: string[] = []): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, '').replace(/^'+|'+$/g, '').trim().slice(0, 31).trim() || 'Hoja';
  const taken = (n: string) => used.has(n.toLowerCase()) || reserved.some(r => r.toLowerCase() === n.toLowerCase());
  let candidate = cleaned;
  for (let i = 2; taken(candidate); i++) {
    const suffix = ` (${i})`;
    candidate = cleaned.slice(0, 31 - suffix.length).trimEnd() + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function buildExportData(input: { activities: Activity[]; users: User[]; teams: Team[]; today: string; includeArchived?: boolean }): ExportData {
  const { activities, users, teams, today, includeArchived = false } = input;
  const people = users
    .filter(u => u.username.toLowerCase() !== 'admin')
    .map(u => ({ username: u.username, userName: u.fullName || u.username, email: u.email || '' }))
    .sort((a, b) => a.userName.localeCompare(b.userName, 'es'));
  const teamName = (id?: string | null) => (id ? teams.find(t => t.id === id)?.name || 'Equipo' : 'Personal');

  const used = new Set<string>();
  const summary: SummaryRow[] = [];
  const byUser: UserSheet[] = [];

  for (const p of people) {
    const mine = activities
      .filter(a => (includeArchived || !a.archived) && a.username.toLowerCase() === p.username.toLowerCase())
      // current tasks first, archived ones after them; then by status and end date
      .sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.endDate.localeCompare(b.endDate));

    const rows: ExportTaskRow[] = mine.map(a => {
      const late = isOverdue(a, today);
      return {
        username: p.username,
        userName: p.userName,
        email: p.email,
        title: a.title,
        description: a.description || '',
        status: STATUS_LABEL[a.status],
        priority: PRIORITY_LABEL[a.priority] ?? a.priority,
        progress: typeof a.progress === 'number' ? a.progress : null,
        start: a.startDate,
        end: a.endDate,
        overdue: late,
        overdueDays: late ? daysOverdue(a.endDate, today) : 0,
        assignedBy: a.assignedBy || '',
        scope: teamName(a.teamId),
        createdAt: a.createdAt,
        completedAt: a.completedAt || '',
        archived: !!a.archived,
      };
    });

    const count = (s: Activity['status']) => mine.filter(a => a.status === s).length;
    summary.push({
      username: p.username,
      userName: p.userName,
      email: p.email,
      todo: count('todo'),
      doing: count('doing'),
      done: count('done'),
      cancelled: count('cancelled'),
      total: mine.length,
      overdue: rows.filter(r => r.overdue).length,
      archived: rows.filter(r => r.archived).length,
      rate: mine.length === 0 ? 0 : Math.round((count('done') / mine.length) * 100),
    });
    if (rows.length > 0) {
      byUser.push({ username: p.username, userName: p.userName, sheetName: safeSheetName(p.userName, used, ['Resumen', 'Todas']), rows });
    }
  }

  return { summary, tasks: byUser.flatMap(u => u.rows), byUser, includesArchived: includeArchived };
}
