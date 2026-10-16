import type { Database } from 'sqlite';
import { normalizeEmail } from './email.ts';

export interface NewUserInput {
  username?: unknown;
  fullName?: unknown;
  role?: unknown;
  email?: unknown;
  password?: unknown;
}

export interface ValidNewUser {
  username: string;
  fullName: string;
  role: 'admin' | 'user';
  email: string;
  password: string;
}

export type ValidateResult =
  | { ok: true; user: ValidNewUser }
  | { ok: false; error: 'invalid_username' | 'invalid_name' | 'invalid_email' | 'too_short' };

export function validateNewUser(input: NewUserInput, minPasswordLength: number): ValidateResult {
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (!username) return { ok: false, error: 'invalid_username' };
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  if (!fullName) return { ok: false, error: 'invalid_name' };
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: 'invalid_email' };
  const role = input.role === 'admin' ? 'admin' : 'user';
  const password = typeof input.password === 'string' ? input.password : '';
  if (role === 'admin' && password.length < minPasswordLength) return { ok: false, error: 'too_short' };
  return { ok: true, user: { username, fullName, role, email, password } };
}

// Only called after the caller has proven to be an admin. Never overwrites an existing
// user (usernames are case-insensitive), so it can't be used to alter someone's role.
export async function createUser(
  db: Database,
  u: { username: string; fullName: string; role: 'admin' | 'user'; email: string; passwordHash: string | null }
): Promise<{ ok: true } | { ok: false; error: 'exists' }> {
  const existing = await db.get('SELECT username FROM users WHERE username = ? COLLATE NOCASE', [u.username]);
  if (existing) return { ok: false, error: 'exists' };
  await db.run(
    'INSERT INTO users (username, fullName, role, lastLogin, passwordHash, email) VALUES (?, ?, ?, ?, ?, ?)',
    [u.username, u.fullName, u.role, new Date().toISOString(), u.passwordHash, u.email]
  );
  return { ok: true };
}

// A login updates an EXISTING user only — it never creates one (accounts are created by
// admins). Returns false when the user doesn't exist. Name/email only fill in blanks.
export async function touchLogin(db: Database, username: string, fullName?: string | null, email?: string | null): Promise<boolean> {
  const result = await db.run(
    `UPDATE users SET lastLogin = ?,
       fullName = COALESCE(fullName, ?),
       email = COALESCE(email, ?)
     WHERE username = ? COLLATE NOCASE`,
    [new Date().toISOString(), fullName || null, email || null, username]
  );
  return (result.changes ?? 0) > 0;
}
