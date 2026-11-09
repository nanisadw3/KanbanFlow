import type { Database } from 'sqlite';
import { ROLE_MANAGER, roleNeedsPassword } from './roles.ts';

export type SetPasswordError = 'forbidden' | 'not_found' | 'not_supported' | 'too_short';

// Setting ANOTHER account's password is reserved to the role manager (Inaki), like role changes. The caller
// has already proven (with their own password) to be an admin. The target must be an account that signs in
// with a password: an admin, a power user or the built-in "admin"; a regular user or a viewer has none.
// A power user created before passwords were required has no hash yet: this is how it gets one.
export async function setPasswordFor(
  db: Database,
  input: { manager: string; username: unknown; newPassword: unknown },
  opts: { minPasswordLength: number; hashPassword: (password: string) => Promise<string> }
): Promise<{ ok: true; username: string } | { ok: false; error: SetPasswordError }> {
  if (input.manager.toLowerCase() !== ROLE_MANAGER) return { ok: false, error: 'forbidden' };
  const target = await db.get<{ username: string; role: string | null }>(
    'SELECT username, role FROM users WHERE username = ? COLLATE NOCASE',
    [typeof input.username === 'string' ? input.username : '']
  );
  if (!target) return { ok: false, error: 'not_found' };
  if (!(roleNeedsPassword(target.role) || target.username.toLowerCase() === 'admin')) return { ok: false, error: 'not_supported' };
  const password = typeof input.newPassword === 'string' ? input.newPassword : '';
  if (password.length < opts.minPasswordLength) return { ok: false, error: 'too_short' };
  await db.run('UPDATE users SET passwordHash = ? WHERE username = ?', [await opts.hashPassword(password), target.username]);
  return { ok: true, username: target.username };
}
