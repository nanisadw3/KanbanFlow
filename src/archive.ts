// What belongs on the live board / dashboards vs. in the Archivero. One definition shared
// by the board, the admin dashboard, Productividad and the Archivero modal.
interface ArchivableTask {
  status: string;
  archived?: boolean;
  completedAt?: string | null;
}

export type ArchiveTab = 'all' | 'done' | 'cancelled' | 'archived';

// An archived task that is still open (todo/doing) is shelved: it stops counting as open or
// overdue. Done/cancelled ones keep counting in totals — they are outcomes, not pending work.
export const isLive = (a: ArchivableTask): boolean =>
  !a.archived || a.status === 'done' || a.status === 'cancelled';

// NOTHING is archived by itself: a completed task stays in "Hecho" until the user archives it (one by
// one, with "archivar todo" or with "seleccionar para archivar"). The user asked for this explicitly.
export const isDoneVisibleOnBoard = (a: ArchivableTask): boolean => !a.archived;

// The Archivero holds what the user archived (any status) plus every cancelled task.
export const inArchivero = (a: ArchivableTask): boolean => !!a.archived || a.status === 'cancelled';

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
