// The three kinds of task and the helpers around them. Pure so it can be tested
// (server/taskKinds.test.ts).
export type TaskKind = 'single' | 'shared' | 'recurring';
export type Repeat = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

export const REPEAT_OPTIONS: { value: Repeat; label: string }[] = [
  { value: 'weekly', label: 'Cada semana' },
  { value: 'biweekly', label: 'Cada 2 semanas' },
  { value: 'monthly', label: 'Cada mes' },
  { value: 'quarterly', label: 'Cada trimestre' },
  { value: 'semiannual', label: 'Cada semestre' },
  { value: 'yearly', label: 'Cada año' },
];

// A repeating task has no dates: the rule says which day a new one is generated. Weekly and
// biweekly use a weekday (Monday to Friday), the rest a day of the month, and yearly also a month.
export const WEEKDAYS = [
  { value: 1, label: 'Lunes', short: 'Lun' },
  { value: 2, label: 'Martes', short: 'Mar' },
  { value: 3, label: 'Miércoles', short: 'Mié' },
  { value: 4, label: 'Jueves', short: 'Jue' },
  { value: 5, label: 'Viernes', short: 'Vie' },
];
export const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const usesWeekday = (r: Repeat): boolean => r === 'weekly' || r === 'biweekly';

// Keeps a previously chosen day valid when the frequency changes (weekdays only go to 5).
export const dayFor = (r: Repeat, current: number): number =>
  usesWeekday(r) ? (current >= 1 && current <= 5 ? current : 1) : (current >= 1 && current <= 31 ? current : 1);

export interface RepeatRule {
  repeat?: string | null;
  repeatDay?: number | null;
  repeatMonth?: number | null;
}

// `label` is the full sentence ("Cada semana, los lunes"); `short` fits a card badge ("Lunes").
export function describeRepeat(r: RepeatRule): { label: string; short: string } {
  const every = REPEAT_OPTIONS.find(o => o.value === r.repeat)?.label ?? 'Repetitiva';
  const day = r.repeatDay ?? 0;
  if (r.repeat === 'weekly' || r.repeat === 'biweekly') {
    const wd = WEEKDAYS.find(w => w.value === day);
    return wd ? { label: `${every}, los ${wd.label.toLowerCase()}`, short: wd.label } : { label: every, short: 'Repetitiva' };
  }
  if (r.repeat === 'yearly') {
    const month = MONTH_NAMES[(r.repeatMonth ?? 0) - 1];
    return day && month
      ? { label: `${every}, el ${day} de ${month}`, short: `${day} ${month.slice(0, 3)}` }
      : { label: every, short: 'Repetitiva' };
  }
  return day ? { label: `${every}, el día ${day}`, short: `Día ${day}` } : { label: every, short: 'Repetitiva' };
}

// CSS class that gives a shared or repeating task its own color; nothing for a normal one.
export const kindClass = (act: { kind?: string }): string =>
  act.kind === 'shared' ? 'kind-shared' : act.kind === 'recurring' ? 'kind-recurring' : '';

interface SharedCopy {
  sharedId?: string | null;
  status: string;
  progress?: number | null;
}

// Every person's copy of one shared task.
export const sharedGroup = <T extends SharedCopy>(acts: T[], sharedId?: string | null): T[] =>
  sharedId ? acts.filter(a => a.sharedId === sharedId) : [];

// What a shared task's card shows: the team average, everyone who has a copy and how many comments
// the logged-in person hasn't read yet.
export interface SharedStats {
  average: number | null;
  people: number;
  members?: { name: string; online?: boolean }[];
  unread?: number;
}

// Comments by OTHER people that `me` hasn't seen: those after their last read mark or, if they never
// opened the task, after their own copy of it was created. Mirrors `countUnread` in server/shared.ts.
export function unreadComments(
  comments: { sharedId: string; username: string; createdAt: string }[],
  reads: { username: string; sharedId: string; lastReadAt: string }[],
  task: { sharedId: string; myCopyCreatedAt?: string },
  me: string
): number {
  const mine = me.toLowerCase();
  const since = reads.find(r => r.sharedId === task.sharedId && r.username.toLowerCase() === mine)?.lastReadAt ?? task.myCopyCreatedAt ?? '';
  return comments.filter(c => c.sharedId === task.sharedId && c.username.toLowerCase() !== mine && c.createdAt > since).length;
}

// One person's progress on a shared task: done is 100 even if the number was never filled in.
export const copyProgress = (a: SharedCopy): number =>
  a.status === 'done' ? 100 : a.status === 'todo' ? (a.progress ?? 0) : (a.progress ?? 50);

// Team progress = average of everyone's progress. Cancelled copies don't count (that person is
// out of it).
export function sharedProgress(group: SharedCopy[]): { average: number | null; people: number } {
  const active = group.filter(a => a.status !== 'cancelled');
  if (active.length === 0) return { average: null, people: group.length };
  const total = active.reduce((n, a) => n + copyProgress(a), 0);
  return { average: Math.round(total / active.length), people: group.length };
}
