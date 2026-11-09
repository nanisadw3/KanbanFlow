// Editing a team (name and members). Only an admin may do it. People taken off the team keep the tasks
// already assigned to them on its board (no cascade, same as everywhere else in the app); they just
// stop being offered as assignees and stop seeing the team.
import type { Database } from 'sqlite';

export const MAX_TEAM_NAME = 60;

export type TeamError = 'not_found' | 'forbidden' | 'invalid_name' | 'no_members' | 'name_taken';

export async function updateTeam(
  db: Database,
  input: { teamId?: unknown; name?: unknown; memberUsernames?: unknown; by?: unknown }
): Promise<
  | { ok: true; removed: string[]; added: string[]; renamed: boolean }
  | { ok: false; error: TeamError }
> {
  const team = await db.get<{ id: string; name: string; memberUsernames: string }>(
    'SELECT id, name, memberUsernames FROM teams WHERE id = ?', [typeof input.teamId === 'string' ? input.teamId : '']
  );
  if (!team) return { ok: false, error: 'not_found' };

  const actor = await db.get<{ username: string; role: string | null }>(
    'SELECT username, role FROM users WHERE username = ? COLLATE NOCASE', [typeof input.by === 'string' ? input.by : '']
  );
  if (!actor || !(actor.role === 'admin' || actor.username.toLowerCase() === 'admin')) return { ok: false, error: 'forbidden' };

  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > MAX_TEAM_NAME) return { ok: false, error: 'invalid_name' };
  const clash = await db.get('SELECT 1 FROM teams WHERE id != ? AND LOWER(name) = LOWER(?)', [team.id, name]);
  if (clash) return { ok: false, error: 'name_taken' };

  // Members: known users only, canonical spelling, no duplicates, never the built-in admin.
  const known = await db.all<{ username: string }[]>('SELECT username FROM users');
  const byLower = new Map(known.map(u => [u.username.toLowerCase(), u.username]));
  const wanted = Array.isArray(input.memberUsernames) ? input.memberUsernames : [];
  const members: string[] = [];
  for (const raw of wanted) {
    const canon = typeof raw === 'string' ? byLower.get(raw.trim().toLowerCase()) : undefined;
    if (canon && canon.toLowerCase() !== 'admin' && !members.includes(canon)) members.push(canon);
  }
  if (members.length === 0) return { ok: false, error: 'no_members' };

  const before: string[] = JSON.parse(team.memberUsernames || '[]');
  const beforeLower = new Set(before.map(m => m.toLowerCase()));
  const afterLower = new Set(members.map(m => m.toLowerCase()));
  await db.run('UPDATE teams SET name = ?, memberUsernames = ? WHERE id = ?', [name, JSON.stringify(members), team.id]);
  return {
    ok: true,
    removed: before.filter(m => !afterLower.has(m.toLowerCase())),
    added: members.filter(m => !beforeLower.has(m.toLowerCase())),
    renamed: name !== team.name,
  };
}
