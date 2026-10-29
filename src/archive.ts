// What belongs on the live board / dashboards vs. in the Archivero. One definition shared
// by the board, the admin dashboard, Productividad and the Archivero modal.
interface ArchivableTask {
  status: string;
  archived?: boolean;
  completedAt?: string | null;
}

export type ArchiveTab = 'all' | 'done' | 'cancelled' | 'archived';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// An archived task that is still open (todo/doing) is shelved: it stops counting as open or
// overdue. Done/cancelled ones keep counting in totals — they are outcomes, not pending work.
export const isLive = (a: ArchivableTask): boolean =>
  !a.archived || a.status === 'done' || a.status === 'cancelled';

// A completed task stays on the live board for 1 day (or when it has no completedAt yet —
// legacy data), then drops off it; archived ones never show on the board.
export const isDoneVisibleOnBoard = (a: ArchivableTask, nowMs: number): boolean =>
  !a.archived && (!a.completedAt || nowMs - new Date(a.completedAt).getTime() < ONE_DAY_MS);

// The Archivero holds: anything archived (any status), every cancelled task, and completed
// tasks that already left the board.
export const inArchivero = (a: ArchivableTask, nowMs: number): boolean =>
  !!a.archived || a.status === 'cancelled' || (a.status === 'done' && !isDoneVisibleOnBoard(a, nowMs));

export const matchesTab = (a: ArchivableTask, tab: ArchiveTab): boolean => {
  switch (tab) {
    case 'done': return a.status === 'done';
    case 'cancelled': return a.status === 'cancelled';
    case 'archived': return !!a.archived;
    default: return true;
  }
};

export const archiveTabCounts = (list: ArchivableTask[]): Record<ArchiveTab, number> => ({
  all: list.length,
  done: list.filter(a => matchesTab(a, 'done')).length,
  cancelled: list.filter(a => matchesTab(a, 'cancelled')).length,
  archived: list.filter(a => matchesTab(a, 'archived')).length,
});

// The admin dashboard's "Ver" switch: every task, only the ones not archived, or only the archived ones.
export type ArchiveView = 'all' | 'active' | 'archived';

export const matchesArchiveView = (a: ArchivableTask, view: ArchiveView): boolean =>
  view === 'all' ? true : view === 'archived' ? !!a.archived : !a.archived;

export const archiveViewCounts = (list: ArchivableTask[]): Record<ArchiveView, number> => ({
  all: list.length,
  active: list.filter(a => matchesArchiveView(a, 'active')).length,
  archived: list.filter(a => matchesArchiveView(a, 'archived')).length,
});
