// Single definition of "overdue" shared by the board, the admin dashboard and the
// productivity page. The server has its own copy of the rule in server/overdue.ts (SQL).

export const todayString = (now: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

interface DatedTask {
  endDate: string;
  status: string;
  archived?: boolean;
}

// Overdue = end date strictly before today and the task still open (todo/doing).
export const isOverdue = (a: DatedTask, today: string): boolean =>
  !a.archived && !!a.endDate && a.endDate < today && a.status !== 'done' && a.status !== 'cancelled';

const dayNumber = (ymd: string): number => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export const daysOverdue = (endDate: string, today: string): number =>
  dayNumber(today) - dayNumber(endDate);

export const overdueLabel = (endDate: string, today: string): string => {
  const n = daysOverdue(endDate, today);
  if (n <= 0) return '';
  return n === 1 ? 'Venció ayer' : `Venció hace ${n} días`;
};

export const countOpenAndOverdue = (acts: DatedTask[], today: string) => {
  const open = acts.filter(a => !a.archived && (a.status === 'todo' || a.status === 'doing'));
  return { open: open.length, overdue: open.filter(a => isOverdue(a, today)).length };
};

// Share of the still-open work that is late (not of all tasks).
export const overdueRate = (c: { open: number; overdue: number }): number =>
  c.open === 0 ? 0 : Math.round((c.overdue / c.open) * 100);

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const formatShortDate = (ymd: string, currentYear: number = new Date().getFullYear()): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return ymd;
  return `${d} ${MONTHS[m - 1]}${y === currentYear ? '' : ` ${y}`}`;
};
