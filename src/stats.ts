import { countOpenAndOverdue, overdueRate } from './dates';

// Pure helpers behind the Productividad page (tested in server/stats.test.ts).
interface StatTask {
  status: string;
  endDate: string;
  archived?: boolean;
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
