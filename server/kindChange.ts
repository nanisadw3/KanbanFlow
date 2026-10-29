import type { Database } from 'sqlite';
import { createSeries, isRepeat, normalizeRule, stopSeries } from './recurrence.ts';

// Changing a task's type after it was created (the user picked the wrong one): individual,
// shared and repeating can all become each other without deleting and re-creating the task.
//
// Leaving "shared" takes the OTHER people's copies off (and their progress; the comments go with
// the task) — the client asks for confirmation first. Leaving "repeating" stops the series, so the
// occurrences already created stay as normal tasks.
const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).substring(2, 11)}`;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['single', 'shared', 'recurring'] as const;
export type Kind = (typeof KINDS)[number];

export type KindChangeError =
  | 'not_found' | 'invalid_kind' | 'same_kind' | 'forbidden' | 'invalid_title' | 'invalid_dates' | 'invalid_repeat';

export interface KindChangeInput {
  id?: unknown;
  to?: unknown;
  by?: unknown;
  usernames?: unknown;   // shared: who ends up on the task (the task's owner is always included)
  repeat?: unknown;      // recurring: the rule
  repeatDay?: unknown;
  repeatMonth?: unknown;
  fields?: { title?: unknown; description?: unknown; startDate?: unknown; endDate?: unknown; priority?: unknown };
}

export interface KindChangeOk {
  ok: true;
  from: Kind;
  to: Kind;
  removed: string[];   // people whose copy was deleted (leaving shared)
  added: string[];     // people who got a new copy (becoming shared)
  all: string[];       // everyone on the task when it became shared
  by: string;
  task: { title: string; description: string; startDate: string; endDate: string; priority: string };
}

interface Row {
  id: string; title: string; description: string; startDate: string; endDate: string; priority: string;
  username: string; assignedBy: string | null; teamId: string | null; kind: string | null; sharedId: string | null; seriesId: string | null;
}

export async function changeKind(
  db: Database,
  input: KindChangeInput,
  today: string,
  now: Date = new Date()
): Promise<KindChangeOk | { ok: false; error: KindChangeError }> {
  const row = await db.get<Row>('SELECT * FROM activities WHERE id = ?', [typeof input.id === 'string' ? input.id : '']);
  if (!row) return { ok: false, error: 'not_found' };
  const to = input.to as Kind;
  if (!KINDS.includes(to)) return { ok: false, error: 'invalid_kind' };
  const from: Kind = row.kind === 'shared' || row.kind === 'recurring' ? row.kind : 'single';
  if (from === to) return { ok: false, error: 'same_kind' };

  const actor = await db.get<{ username: string; role: string | null }>('SELECT username, role FROM users WHERE username = ? COLLATE NOCASE', [typeof input.by === 'string' ? input.by : '']);
  if (!actor) return { ok: false, error: 'forbidden' };
  const isAdmin = actor.role === 'admin' || actor.username.toLowerCase() === 'admin';

  const copies = from === 'shared' && row.sharedId
    ? await db.all<{ id: string; username: string }[]>('SELECT id, username FROM activities WHERE sharedId = ?', [row.sharedId])
    : [];
  // Dropping the other participants is only for someone who is on the task, or an admin.
  if (from === 'shared' && !isAdmin && !copies.some(c => c.username.toLowerCase() === actor.username.toLowerCase())) {
    return { ok: false, error: 'forbidden' };
  }

  // The task as the form has it now (the title etc. may have been edited together with the type).
  const f = input.fields ?? {};
  const title = typeof f.title === 'string' ? f.title.trim() : row.title;
  if (!title) return { ok: false, error: 'invalid_title' };
  const task = {
    title,
    description: typeof f.description === 'string' ? f.description : row.description,
    startDate: typeof f.startDate === 'string' ? f.startDate : row.startDate,
    endDate: typeof f.endDate === 'string' ? f.endDate : row.endDate,
    priority: f.priority === 'alta' || f.priority === 'baja' ? f.priority : 'media',
  };

  // ── Validate everything for the target type BEFORE writing anything ──
  let participants: string[] = [];
  let rule: ReturnType<typeof normalizeRule> | null = null;
  if (to === 'shared') {
    if (!YMD.test(task.startDate) || !YMD.test(task.endDate)) return { ok: false, error: 'invalid_dates' };
    let known = (await db.all<{ username: string }[]>('SELECT username FROM users')).map(u => u.username);
    if (row.teamId) {
      const team = await db.get<{ memberUsernames: string }>('SELECT memberUsernames FROM teams WHERE id = ?', [row.teamId]);
      const members = new Set((JSON.parse(team?.memberUsernames || '[]') as string[]).map(m => m.toLowerCase()));
      known = known.filter(u => members.has(u.toLowerCase()) || u.toLowerCase() === row.username.toLowerCase());
    }
    const byLower = new Map(known.map(u => [u.toLowerCase(), u]));
    const requested = Array.isArray(input.usernames) ? input.usernames : [];
    participants = [...new Set([row.username, ...requested].map(u => byLower.get(String(u).toLowerCase())).filter((u): u is string => !!u))];
  } else if (to === 'recurring') {
    if (!isRepeat(input.repeat)) return { ok: false, error: 'invalid_repeat' };
    rule = normalizeRule(input.repeat, input.repeatDay, input.repeatMonth);
  }

  // ── Leave the old type ──
  const removed: string[] = [];
  if (from === 'shared') {
    for (const c of copies.filter(c => c.id !== row.id)) {
      await db.run('DELETE FROM activities WHERE id = ?', [c.id]);
      removed.push(c.username);
    }
    await db.run('DELETE FROM comment_reads WHERE sharedId = ?', [row.sharedId]);
    await db.run("UPDATE activities SET kind = 'single', sharedId = NULL WHERE id = ?", [row.id]);
  } else if (from === 'recurring' && row.seriesId) {
    await stopSeries(db, row.seriesId); // this occurrence and the earlier ones become single tasks
  }

  // ── Enter the new type ──
  const added: string[] = [];
  if (to === 'shared') {
    const sharedId = newId('shr');
    await db.run("UPDATE activities SET kind = 'shared', sharedId = ?, seriesId = NULL WHERE id = ?", [sharedId, row.id]);
    for (const username of participants.filter(u => u.toLowerCase() !== row.username.toLowerCase())) {
      added.push(username);
      const mine = username.toLowerCase() === actor.username.toLowerCase();
      await db.run(
        `INSERT INTO activities (id, title, description, startDate, endDate, status, username, createdAt, assignedBy, priority, progress, teamId, kind, sharedId)
         VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, 0, ?, 'shared', ?)`,
        [newId('act'), task.title, task.description, task.startDate, task.endDate, username, now.toISOString(), mine ? null : actor.username, task.priority, row.teamId, sharedId]
      );
    }
  } else if (to === 'recurring' && rule) {
    const seriesId = await createSeries(db, {
      rule, title: task.title, description: task.description, priority: task.priority,
      username: row.username, assignedBy: row.assignedBy, teamId: row.teamId, startDate: today,
    });
    // A repeating task has no end date, so it can never be overdue.
    await db.run("UPDATE activities SET kind = 'recurring', seriesId = ?, sharedId = NULL, endDate = '', overdueNotifiedAt = NULL WHERE id = ?", [seriesId, row.id]);
  }

  return { ok: true, from, to, removed, added, all: participants, by: actor.username, task };
}
