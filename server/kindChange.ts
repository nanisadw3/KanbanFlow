import type { Database } from 'sqlite';
import { createSeries, isRepeat, normalizeRule, stopSeries } from './recurrence.ts';

// Changing a task's type after it was created (the user picked the wrong one). A task is two
// independent things: SHARED (one copy per person) and REPEATING (a series generates it again), so
// there are four types: individual, shared, repeating and shared + repeating. Any of them can become
// any other without deleting and re-creating the task.
//
// Leaving "shared" takes the OTHER people's copies off (and their progress; the comments go with the
// task) — the client asks for confirmation first. Leaving "repeating" stops the series: the occurrences
// already created stay as normal (or shared) tasks.
const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).substring(2, 11)}`;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type KindChangeError =
  | 'not_found' | 'same_kind' | 'forbidden' | 'invalid_title' | 'invalid_dates' | 'invalid_repeat';

export interface KindChangeInput {
  id?: unknown;
  by?: unknown;
  shared?: unknown;      // the type the task should have afterwards
  repeating?: unknown;
  usernames?: unknown;   // becoming shared: who ends up on the task (the task's owner is always included)
  repeat?: unknown;      // becoming repeating: the rule
  repeatDay?: unknown;
  repeatMonth?: unknown;
  fields?: { title?: unknown; description?: unknown; startDate?: unknown; endDate?: unknown; priority?: unknown };
}

export interface KindChangeOk {
  ok: true;
  wasShared: boolean;
  nowShared: boolean;
  wasRepeating: boolean;
  nowRepeating: boolean;
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
  const toShared = input.shared === true;
  const toRepeating = input.repeating === true;
  const fromShared = row.kind === 'shared' && !!row.sharedId;
  const fromRepeating = !!row.seriesId;
  if (fromShared === toShared && fromRepeating === toRepeating) return { ok: false, error: 'same_kind' };

  const actor = await db.get<{ username: string; role: string | null }>('SELECT username, role FROM users WHERE username = ? COLLATE NOCASE', [typeof input.by === 'string' ? input.by : '']);
  if (!actor) return { ok: false, error: 'forbidden' };
  const isAdmin = actor.role === 'admin' || actor.username.toLowerCase() === 'admin';

  const copies = fromShared
    ? await db.all<{ id: string; username: string }[]>('SELECT id, username FROM activities WHERE sharedId = ?', [row.sharedId])
    : [];
  // Changing a shared task is only for someone who is on it, or an admin.
  if (fromShared && !isAdmin && !copies.some(c => c.username.toLowerCase() === actor.username.toLowerCase())) {
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
    // A repeating task has no end date, so it can never be overdue.
    endDate: toRepeating ? '' : typeof f.endDate === 'string' ? f.endDate : row.endDate,
    priority: f.priority === 'alta' || f.priority === 'baja' ? f.priority : 'media',
  };

  // ── Validate everything for the target type BEFORE writing anything ──
  let participants: string[] = [];
  if (toShared && fromShared) {
    participants = copies.map(c => c.username); // who is on it changes through the participants editor
  } else if (toShared) {
    let known = (await db.all<{ username: string }[]>('SELECT username FROM users')).map(u => u.username);
    if (row.teamId) {
      const team = await db.get<{ memberUsernames: string }>('SELECT memberUsernames FROM teams WHERE id = ?', [row.teamId]);
      const members = new Set((JSON.parse(team?.memberUsernames || '[]') as string[]).map(m => m.toLowerCase()));
      known = known.filter(u => members.has(u.toLowerCase()) || u.toLowerCase() === row.username.toLowerCase());
    }
    const byLower = new Map(known.map(u => [u.toLowerCase(), u]));
    const requested = Array.isArray(input.usernames) ? input.usernames : [];
    participants = [...new Set([row.username, ...requested].map(u => byLower.get(String(u).toLowerCase())).filter((u): u is string => !!u))];
  }
  if (toShared && !toRepeating && (!YMD.test(task.startDate) || !YMD.test(task.endDate))) return { ok: false, error: 'invalid_dates' };
  let rule: ReturnType<typeof normalizeRule> | null = null;
  if (toRepeating && !fromRepeating) {
    if (!isRepeat(input.repeat)) return { ok: false, error: 'invalid_repeat' };
    rule = normalizeRule(input.repeat, input.repeatDay, input.repeatMonth);
  }

  // ── Leave what it no longer is ──
  const oldSeriesId = row.seriesId;
  if (fromRepeating && !toRepeating && oldSeriesId) {
    await stopSeries(db, oldSeriesId); // this task and the other copies stop being part of a series
  }
  const removed: string[] = [];
  if (fromShared && !toShared) {
    for (const c of copies.filter(c => c.id !== row.id)) {
      await db.run('DELETE FROM activities WHERE id = ?', [c.id]);
      removed.push(c.username);
    }
    await db.run('DELETE FROM comment_reads WHERE sharedId = ?', [row.sharedId]);
    await db.run("UPDATE activities SET kind = 'single', sharedId = NULL WHERE id = ?", [row.id]);
    // A series that stays becomes an ordinary one, owned by whoever kept the task.
    if (fromRepeating && toRepeating && oldSeriesId) {
      await db.run('UPDATE recurrences SET participants = NULL, username = ?, assignedBy = ? WHERE id = ?', [row.username, row.assignedBy, oldSeriesId]);
    }
  }

  // ── Become what it now is ──
  let seriesId: string | null = toRepeating ? oldSeriesId : null;
  if (toRepeating && !fromRepeating && rule) {
    seriesId = await createSeries(db, {
      rule, title: task.title, description: task.description, priority: task.priority,
      username: row.username, assignedBy: toShared ? actor.username : row.assignedBy, teamId: row.teamId, startDate: today,
      participants: toShared ? participants : null,
    });
  } else if (toRepeating && fromRepeating && toShared && !fromShared && oldSeriesId) {
    // an ordinary series turns into a shared one: its next occurrences go to everyone on the task
    await db.run('UPDATE recurrences SET participants = ?, assignedBy = ? WHERE id = ?', [JSON.stringify(participants), actor.username, oldSeriesId]);
  }

  const added: string[] = [];
  let sharedId: string | null = fromShared && toShared ? row.sharedId : null;
  if (toShared && !fromShared) {
    sharedId = newId('shr');
    await db.run("UPDATE activities SET kind = 'shared', sharedId = ? WHERE id = ?", [sharedId, row.id]);
    for (const username of participants.filter(u => u.toLowerCase() !== row.username.toLowerCase())) {
      added.push(username);
      const mine = username.toLowerCase() === actor.username.toLowerCase();
      await db.run(
        `INSERT INTO activities (id, title, description, startDate, endDate, status, username, createdAt, assignedBy, priority, progress, teamId, kind, sharedId, seriesId)
         VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, 0, ?, 'shared', ?, ?)`,
        [newId('act'), task.title, task.description, task.startDate, task.endDate, username, now.toISOString(), mine ? null : actor.username, task.priority, row.teamId, sharedId, seriesId]
      );
    }
  }

  // Every copy (or the single task) now carries the final kind, series and end date.
  const kind = toShared ? 'shared' : toRepeating ? 'recurring' : 'single';
  if (toShared) {
    await db.run(
      "UPDATE activities SET kind = 'shared', seriesId = ?, endDate = CASE WHEN ? THEN '' ELSE endDate END, overdueNotifiedAt = CASE WHEN ? THEN NULL ELSE overdueNotifiedAt END WHERE sharedId = ?",
      [seriesId, toRepeating ? 1 : 0, toRepeating ? 1 : 0, sharedId]
    );
  } else {
    await db.run(
      "UPDATE activities SET kind = ?, seriesId = ?, endDate = CASE WHEN ? THEN '' ELSE endDate END, overdueNotifiedAt = CASE WHEN ? THEN NULL ELSE overdueNotifiedAt END WHERE id = ?",
      [kind, seriesId, toRepeating ? 1 : 0, toRepeating ? 1 : 0, row.id]
    );
  }

  return {
    ok: true, wasShared: fromShared, nowShared: toShared, wasRepeating: fromRepeating, nowRepeating: toRepeating,
    removed, added, all: participants, by: actor.username, task,
  };
}
