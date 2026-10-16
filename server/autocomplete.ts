export interface AutoCompleteNext {
  status: 'todo' | 'doing' | 'done' | 'cancelled';
  progress: number;
  completedAt: string | null;
}

// A task whose progress is raised to 100 moves to "done" by itself. Only the *change* to
// 100 counts, so dragging an already-100% task back to "doing" doesn't bounce it.
export function autoCompleteAtFull(
  prev: { progress: number | null },
  next: AutoCompleteNext,
  now: string
): AutoCompleteNext {
  const wasFull = (prev.progress ?? 0) >= 100;
  if (next.progress >= 100 && !wasFull && (next.status === 'todo' || next.status === 'doing')) {
    return { status: 'done', progress: 100, completedAt: now };
  }
  return next;
}
