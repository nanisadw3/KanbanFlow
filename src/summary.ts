// What a user sees right after logging in: tasks assigned to them since their previous
// login, and everything of theirs that is overdue. Pure so it can be tested (server/summary.test.ts).
import { isLive } from './archive';
import { isOverdue } from './dates';
import type { Activity } from './db';

export interface LoginSummary {
  // Assigned to the user by someone else after their previous login and not yet late.
  fresh: Activity[];
  // The user's open tasks whose end date has passed, most overdue first.
  overdue: Activity[];
}

const sameUser = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function buildLoginSummary(
  activities: Activity[],
  username: string,
  previousLogin: string | null | undefined,
  today: string
): LoginSummary {
  const mine = activities.filter(
    a => sameUser(a.username, username) && isLive(a) && (a.status === 'todo' || a.status === 'doing')
  );
  const overdue = mine.filter(a => isOverdue(a, today)).sort((a, b) => a.endDate.localeCompare(b.endDate));
  const overdueIds = new Set(overdue.map(a => a.id));

  // Without a known previous login there is no "since", so nothing is flagged as new
  // (better than announcing the user's whole backlog as news).
  const since = previousLogin ? Date.parse(previousLogin) : NaN;
  const fresh = Number.isNaN(since)
    ? []
    : mine
        .filter(a => !overdueIds.has(a.id) && !!a.assignedBy && !sameUser(a.assignedBy, username) && Date.parse(a.createdAt) > since)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { fresh, overdue };
}
