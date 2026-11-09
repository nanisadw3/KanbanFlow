import type { Database } from 'sqlite';

// Only this username may change other people's roles (decided by the app owner). Compared
// case-insensitively, like every other username lookup.
export const ROLE_MANAGER = 'inaki';

export type RoleChangeError =
  | 'forbidden'
  | 'invalid_role'
  | 'not_found'
  | 'protected'
  | 'self'
  | 'too_short'
  | 'password_required';

// 'power' sees the whole admin panel but changes nothing; 'viewer' only sees the activity map. A power
// user signs in with a password, like an admin; a viewer, like a regular user, with just the username.
// Neither is an admin to the server, so every admin-gated action (users, passwords, mail, notices,
// teams, roles) already refuses them.
export const ROLES = ['admin', 'power', 'viewer', 'user'] as const;
export type Role = (typeof ROLES)[number];
// Staff = admin or power user: they may work on ANY task (create and assign, comment, edit, move,
// archive). Only admins do the technical side (users, passwords, mail, notices, roles, teams).
export const isStaff = (row: { username: string; role: string | null | undefined }): boolean =>
  row.role === 'admin' || row.role === 'power' || row.username.toLowerCase() === 'admin';

// Roles that sign in with a password.
export const roleNeedsPassword = (role: unknown): boolean => role === 'admin' || role === 'power';

export type RoleChangeResult = { ok: true; role: Role } | { ok: false; error: RoleChangeError };

// Called after the caller has already proven (with their own password) to be an admin.
//  - Giving someone a role that signs in with a password (admin, power user) needs a password for them:
//    the server hands any admin without one the default password, so letting it through without one
//    would leave an open account (and a power user with no password could not sign in at all).
//  - Any move to a non-admin role (user, power, viewer) clears the password hash, so a later promotion starts clean.
//  - The built-in "admin" account and the manager's own role can't be changed.
export async function changeUserRole(
  db: Database,
  input: { manager: string; username: unknown; role: unknown; password: unknown },
  opts: { minPasswordLength: number; hashPassword: (password: string) => Promise<string> }
): Promise<RoleChangeResult> {
  if (input.manager.toLowerCase() !== ROLE_MANAGER) return { ok: false, error: 'forbidden' };
  const role = ROLES.find(r => r === input.role);
  if (!role) return { ok: false, error: 'invalid_role' };

  const target = await db.get<{ username: string; role: string | null; passwordHash: string | null }>(
    'SELECT username, role, passwordHash FROM users WHERE username = ? COLLATE NOCASE',
    [typeof input.username === 'string' ? input.username : '']
  );
  if (!target) return { ok: false, error: 'not_found' };
  if (target.username.toLowerCase() === 'admin') return { ok: false, error: 'protected' };
  if (target.username.toLowerCase() === input.manager.toLowerCase()) return { ok: false, error: 'self' };

  if (roleNeedsPassword(role)) {
    // Already has this role with a password: nothing to do, and a password sent along must not reset theirs.
    if (target.role === role && target.passwordHash) return { ok: true, role };
    const password = typeof input.password === 'string' ? input.password : '';
    if (password.length < opts.minPasswordLength) {
      return { ok: false, error: password === '' ? 'password_required' : 'too_short' };
    }
    await db.run('UPDATE users SET role = ?, passwordHash = ? WHERE username = ?', [role, await opts.hashPassword(password), target.username]);
    return { ok: true, role };
  }

  // A viewer has no e-mail (and no board): turning someone into one also clears their address, so no
  // notice is ever sent to them.
  if (role === 'viewer') {
    await db.run('UPDATE users SET role = ?, passwordHash = NULL, email = NULL WHERE username = ?', [role, target.username]);
    return { ok: true, role };
  }
  await db.run('UPDATE users SET role = ?, passwordHash = NULL WHERE username = ?', [role, target.username]);
  return { ok: true, role };
}
