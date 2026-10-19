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

export type RoleChangeResult = { ok: true; role: 'admin' | 'user' } | { ok: false; error: RoleChangeError };

// Called after the caller has already proven (with their own password) to be an admin.
//  - Promoting someone needs a password for them: the server hands any admin without one the
//    default password, so letting a promotion through without one would leave an open account.
//  - Demoting clears the password hash, so a later promotion starts clean.
//  - The built-in "admin" account and the manager's own role can't be changed.
export async function changeUserRole(
  db: Database,
  input: { manager: string; username: unknown; role: unknown; password: unknown },
  opts: { minPasswordLength: number; hashPassword: (password: string) => Promise<string> }
): Promise<RoleChangeResult> {
  if (input.manager.toLowerCase() !== ROLE_MANAGER) return { ok: false, error: 'forbidden' };
  if (input.role !== 'admin' && input.role !== 'user') return { ok: false, error: 'invalid_role' };
  const role = input.role;

  const target = await db.get<{ username: string; role: string | null; passwordHash: string | null }>(
    'SELECT username, role, passwordHash FROM users WHERE username = ? COLLATE NOCASE',
    [typeof input.username === 'string' ? input.username : '']
  );
  if (!target) return { ok: false, error: 'not_found' };
  if (target.username.toLowerCase() === 'admin') return { ok: false, error: 'protected' };
  if (target.username.toLowerCase() === input.manager.toLowerCase()) return { ok: false, error: 'self' };

  if (role === 'admin') {
    // Already an admin: nothing to do, and a password sent along must not reset theirs.
    if (target.role === 'admin') return { ok: true, role };
    const password = typeof input.password === 'string' ? input.password : '';
    if (password.length < opts.minPasswordLength) {
      return { ok: false, error: password === '' ? 'password_required' : 'too_short' };
    }
    await db.run('UPDATE users SET role = ?, passwordHash = ? WHERE username = ?', [role, await opts.hashPassword(password), target.username]);
    return { ok: true, role };
  }

  await db.run('UPDATE users SET role = ?, passwordHash = NULL WHERE username = ?', [role, target.username]);
  return { ok: true, role };
}
