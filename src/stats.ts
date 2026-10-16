import { countOpenAndOverdue, overdueRate, isOverdue, daysOverdue, todayString } from './dates';

// Pure helpers behind the Productividad page (tested in server/stats.test.ts).
interface StatTask {
  status: string;
  endDate: string;
  archived?: boolean;
  createdAt?: string;
  completedAt?: string | null;
  teamId?: string | null;
}

export interface StatusCounts {
  todo: number;
  doing: number;
  done: number;
  cancelled: number;
}

export interface UserSummary extends StatusCounts {
  total: number;
  rate: number;          // % of ALL their tasks that are done
  open: number;          // todo + doing, not archived
  overdue: number;       // open tasks past their end date
  overdueShare: number;  // % of the OPEN tasks that are overdue
}

export function summarizeUser(acts: StatTask[], today: string): UserSummary {
  const count = (status: string) => acts.filter(a => a.status === status).length;
  const todo = count('todo');
  const doing = count('doing');
  const done = count('done');
  const cancelled = count('cancelled');
  const total = acts.length;
  const c = countOpenAndOverdue(acts, today);
  return {
    todo, doing, done, cancelled, total,
    rate: total === 0 ? 0 : Math.round((done / total) * 100),
    open: c.open,
    overdue: c.overdue,
    overdueShare: overdueRate(c),
  };
}

export type SortKey = 'rate' | 'overdue' | 'total';

// Returns a new array: the chosen key descending, ties broken by total (then input order).
export function sortUsers<T extends { rate: number; overdue: number; total: number }>(rows: T[], by: SortKey): T[] {
  return [...rows].sort((a, b) => b[by] - a[by] || b.total - a.total);
}

export type DonutKey = 'done' | 'doing' | 'todo' | 'cancelled';

// Share of the ring each status takes, as fractions of 1 with their start offset. Statuses
// with no tasks are left out; the caller multiplies by the circumference.
export function donutArcs(counts: StatusCounts): { key: DonutKey; fraction: number; start: number }[] {
  const total = counts.todo + counts.doing + counts.done + counts.cancelled;
  if (total === 0) return [];
  const order: DonutKey[] = ['done', 'doing', 'todo', 'cancelled'];
  let start = 0;
  const arcs: { key: DonutKey; fraction: number; start: number }[] = [];
  for (const key of order) {
    if (counts[key] === 0) continue;
    const fraction = counts[key] / total;
    arcs.push({ key, fraction, start });
    start += fraction;
  }
  return arcs;
}

// ───────── Period and scope ─────────

export type Period = '7d' | '30d' | '90d' | 'all';
export type Scope = 'personal' | 'teams' | 'all';

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<Exclude<Period, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

// Start of the period as epoch ms, or null for "all time".
export const periodStart = (period: Period, now: Date): number | null =>
  period === 'all' ? null : now.getTime() - PERIOD_DAYS[period] * DAY_MS;

// Open tasks (todo/doing) always count: they are the current workload and hiding an old overdue
// task would hide exactly what needs attention. Done tasks count by their completion date and
// cancelled ones by their creation date (there is no cancellation date); when the date is
// missing (legacy data) the task is kept.
export const inPeriod = (a: StatTask, startMs: number | null): boolean => {
  if (startMs === null) return true;
  if (a.status === 'todo' || a.status === 'doing') return true;
  const ref = a.status === 'done' ? (a.completedAt || a.createdAt) : a.createdAt;
  if (!ref) return true;
  return new Date(ref).getTime() >= startMs;
};

export const inScope = (a: StatTask, scope: Scope): boolean =>
  scope === 'all' ? true : scope === 'teams' ? !!a.teamId : !a.teamId;

// ───────── On-time delivery and time to close ─────────

export interface CloseStats {
  doneTotal: number;
  withDate: number;            // done tasks that have a completedAt (legacy ones don't)
  onTime: number;              // finished on or before their end date (local day)
  onTimeRate: number | null;   // % of withDate, null when there is nothing to measure
  avgCloseDays: number | null; // mean days from creation to completion
}

export function closeStats(tasks: StatTask[]): CloseStats {
  const done = tasks.filter(a => a.status === 'done');
  const dated = done.filter(a => !!a.completedAt);
  const onTime = dated.filter(a => todayString(new Date(a.completedAt as string)) <= a.endDate).length;
  const spans = dated
    .filter(a => !!a.createdAt)
    .map(a => Math.max(0, new Date(a.completedAt as string).getTime() - new Date(a.createdAt as string).getTime()) / DAY_MS);
  return {
    doneTotal: done.length,
    withDate: dated.length,
    onTime,
    onTimeRate: dated.length === 0 ? null : Math.round((onTime / dated.length) * 100),
    avgCloseDays: spans.length === 0 ? null : spans.reduce((n, d) => n + d, 0) / spans.length,
  };
}

// ───────── Weekly trend ─────────

export interface WeekPoint {
  start: string;     // Monday of the week, YYYY-MM-DD (local)
  created: number;
  completed: number;
}

const mondayOf = (d: Date): Date => {
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
};

// Created vs completed per week for the last `weeks` weeks (the current one included), oldest first.
export function weeklyTrend(tasks: StatTask[], now: Date, weeks = 8): WeekPoint[] {
  const currentMonday = mondayOf(now);
  const points: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(currentMonday.getFullYear(), currentMonday.getMonth(), currentMonday.getDate() - 7 * i);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    const within = (iso?: string | null) => !!iso && new Date(iso).getTime() >= start.getTime() && new Date(iso).getTime() < end.getTime();
    points.push({
      start: todayString(start),
      created: tasks.filter(a => within(a.createdAt)).length,
      completed: tasks.filter(a => a.status === 'done' && within(a.completedAt)).length,
    });
  }
  return points;
}

// ───────── Overdue aging and drill-down ─────────

export interface AgingBuckets {
  d1_3: number;
  d4_7: number;
  d8plus: number;
  total: number;
}

export type AgingKey = 'd1_3' | 'd4_7' | 'd8plus';

const agingKeyOf = (days: number): AgingKey => (days <= 3 ? 'd1_3' : days <= 7 ? 'd4_7' : 'd8plus');

export function agingBuckets(tasks: StatTask[], today: string): AgingBuckets {
  const b: AgingBuckets = { d1_3: 0, d4_7: 0, d8plus: 0, total: 0 };
  for (const a of tasks) {
    if (!isOverdue(a, today)) continue;
    b[agingKeyOf(daysOverdue(a.endDate, today))] += 1;
    b.total += 1;
  }
  return b;
}

export type DrillKey = DonutKey | 'overdue' | `aging:${AgingKey}`;

// Which tasks a clicked donut segment, KPI or aging bucket stands for.
export function matchesDrill(a: StatTask, key: DrillKey, today: string): boolean {
  if (key === 'overdue') return isOverdue(a, today);
  if (key.startsWith('aging:')) return isOverdue(a, today) && agingKeyOf(daysOverdue(a.endDate, today)) === key.slice(6);
  return a.status === key;
}

// ───────── Shared look of each status ─────────

// One color per status, shared by the donut, the bars and the legend. Cancelled is gray on
// purpose: red is reserved for "overdue", the thing that needs attention.
export const STATUS_META: Record<DonutKey, { label: string; full: string; icon: string; color: string }> = {
  done: { label: 'Hechas', full: 'Tareas hechas', icon: 'check_circle', color: '--chart-done' },
  doing: { label: 'En curso', full: 'Tareas en curso', icon: 'schedule', color: '--chart-doing' },
  todo: { label: 'Por hacer', full: 'Tareas por hacer', icon: 'assignment', color: '--chart-todo' },
  cancelled: { label: 'Canceladas', full: 'Tareas canceladas', icon: 'cancel', color: '--color-secondary' },
};
export const DONUT_ORDER: DonutKey[] = ['done', 'doing', 'todo', 'cancelled'];
