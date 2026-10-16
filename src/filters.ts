import { isOverdue } from './dates';

// The admin dashboard's filter, as plain data so the user list and the team panel can
// share one definition of "this task matches".
type Status = 'todo' | 'doing' | 'done' | 'cancelled';

export interface TaskFilter {
  statuses: Set<Status>;   // any-of; empty = no restriction
  overdueOnly: boolean;    // extra AND condition
  users: Set<string>;      // lowercased assignees, any-of; empty = no restriction
}

interface FilterableTask {
  status: string;
  endDate: string;
  username: string;
  archived?: boolean;
}

export const isFilterActive = (f: TaskFilter): boolean =>
  f.statuses.size > 0 || f.overdueOnly || f.users.size > 0;

export const matchesFilter = (a: FilterableTask, f: TaskFilter, today: string): boolean =>
  (f.statuses.size === 0 || f.statuses.has(a.status as Status)) &&
  (!f.overdueOnly || isOverdue(a, today)) &&
  (f.users.size === 0 || f.users.has(a.username.toLowerCase()));

export interface MatchSummary {
  matching: number;
  overdue: number;
  todo: number;
  doing: number;
  done: number;
  cancelled: number;
}

export const summarizeMatches = (tasks: FilterableTask[], f: TaskFilter, today: string): MatchSummary => {
  const s: MatchSummary = { matching: 0, overdue: 0, todo: 0, doing: 0, done: 0, cancelled: 0 };
  for (const a of tasks) {
    if (!matchesFilter(a, f, today)) continue;
    s.matching += 1;
    if (isOverdue(a, today)) s.overdue += 1;
    if (a.status === 'todo' || a.status === 'doing' || a.status === 'done' || a.status === 'cancelled') s[a.status] += 1;
  }
  return s;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Short label for a team chip: what, within that team, matched the filter.
export const describeMatches = (s: MatchSummary, f: TaskFilter): string => {
  if (f.overdueOnly) return plural(s.overdue, 'retrasada', 'retrasadas');
  if (f.statuses.size > 0) {
    const parts: string[] = [];
    if (f.statuses.has('todo') && s.todo > 0) parts.push(`${s.todo} por realizar`);
    if (f.statuses.has('doing') && s.doing > 0) parts.push(`${s.doing} en proceso`);
    if (f.statuses.has('done') && s.done > 0) parts.push(plural(s.done, 'completada', 'completadas'));
    if (f.statuses.has('cancelled') && s.cancelled > 0) parts.push(plural(s.cancelled, 'cancelada', 'canceladas'));
    return parts.join(', ');
  }
  return plural(s.matching, 'tarea', 'tareas');
};
