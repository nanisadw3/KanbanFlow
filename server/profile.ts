import type { Database } from 'sqlite';
import { normalizeEmail } from './email.ts';
import { ROLE_MANAGER } from './roles.ts';

// A user editing their own profile: display name, username, email and photo.
// The photo is stored as a data URL in `users.photo` and served by GET /api/avatar/:username; the
// users list only carries `photoUpdatedAt` (used to bust the browser cache), never the image.
export const MAX_PHOTO_BYTES = 400 * 1024;
const MAX_NAME_LENGTH = 80;
const MAX_USERNAME_LENGTH = 32;

// Names nobody may take or give up: the built-in admin and the role manager (renaming either would
// break the rules that identify them by username).
export const RESERVED_USERNAMES = ['admin', ROLE_MANAGER];

// New usernames: letters, digits, dot, underscore and hyphen (they travel in URLs and are typed at login).
export const isValidUsername = (v: string): boolean =>
  v.length > 0 && v.length <= MAX_USERNAME_LENGTH && /^[\p{L}\p{N}._-]+$/u.test(v);

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': b => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  'image/webp': b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

// Accepts only a base64 data URL of a real, small jpeg/png/webp (the bytes are checked, not just the label).
export function parsePhoto(dataUrl: unknown): { mime: string; data: Buffer } | null {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  if (data.length === 0 || data.length > MAX_PHOTO_BYTES || !MAGIC[m[1]](data)) return null;
  return { mime: m[1], data };
}

export type ProfileError = 'not_found' | 'invalid_name' | 'invalid_email' | 'invalid_username' | 'exists' | 'protected' | 'invalid_photo';

export interface ProfilePatch {
  fullName?: unknown;
  newUsername?: unknown;
  email?: unknown;
  photo?: unknown; // undefined = keep, null = remove, string = new data URL
}

// Applies the patch to `current`'s account. Validation happens first, so nothing is written when
// anything is wrong. A rename follows the user everywhere their username is stored.
export async function updateProfile(
  db: Database,
  current: string,
  patch: ProfilePatch,
  now: Date = new Date()
): Promise<{ ok: true; username: string } | { ok: false; error: ProfileError }> {
  const row = await db.get<{ username: string }>('SELECT username FROM users WHERE username = ? COLLATE NOCASE', [current]);
  if (!row) return { ok: false, error: 'not_found' };
  const old = row.username;

  let fullName: string | undefined;
  if (patch.fullName !== undefined) {
    fullName = typeof patch.fullName === 'string' ? patch.fullName.trim() : '';
    if (!fullName || fullName.length > MAX_NAME_LENGTH) return { ok: false, error: 'invalid_name' };
  }

  let email: string | undefined;
  if (patch.email !== undefined) {
    const e = normalizeEmail(patch.email);
    if (!e) return { ok: false, error: 'invalid_email' };
    email = e;
  }

  let username = old;
  if (patch.newUsername !== undefined && patch.newUsername !== old) {
    const wanted = typeof patch.newUsername === 'string' ? patch.newUsername.trim() : '';
    if (!isValidUsername(wanted)) return { ok: false, error: 'invalid_username' };
    // Changing only the capitalization of one's own name is fine; anything else needs to be free.
    if (wanted.toLowerCase() !== old.toLowerCase()) {
      if (RESERVED_USERNAMES.includes(old.toLowerCase()) || RESERVED_USERNAMES.includes(wanted.toLowerCase())) {
        return { ok: false, error: 'protected' };
      }
      const taken = await db.get('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE', [wanted]);
      if (taken) return { ok: false, error: 'exists' };
    } else if (RESERVED_USERNAMES.includes(old.toLowerCase())) {
      return { ok: false, error: 'protected' };
    }
    username = wanted;
  }

  let photo: string | null | undefined;
  if (patch.photo !== undefined) {
    if (patch.photo !== null && !parsePhoto(patch.photo)) return { ok: false, error: 'invalid_photo' };
    photo = patch.photo as string | null;
  }

  if (fullName !== undefined) await db.run('UPDATE users SET fullName = ? WHERE username = ?', [fullName, old]);
  if (email !== undefined) await db.run('UPDATE users SET email = ? WHERE username = ?', [email, old]);
  if (photo !== undefined) {
    await db.run('UPDATE users SET photo = ?, photoUpdatedAt = ? WHERE username = ?', [photo, photo === null ? null : now.toISOString(), old]);
  }
  if (username !== old) await renameUser(db, old, username);
  return { ok: true, username };
}

// Everything that stores a username (case-insensitively compared) follows the rename.
async function renameUser(db: Database, old: string, next: string): Promise<void> {
  await db.run('UPDATE users SET username = ? WHERE username = ?', [next, old]);
  await db.run('UPDATE activities SET username = ? WHERE LOWER(username) = LOWER(?)', [next, old]);
  await db.run('UPDATE activities SET assignedBy = ? WHERE LOWER(assignedBy) = LOWER(?)', [next, old]);
  await db.run('UPDATE comments SET username = ? WHERE LOWER(username) = LOWER(?)', [next, old]);
  await db.run('UPDATE comment_reads SET username = ? WHERE LOWER(username) = LOWER(?)', [next, old]);
  await db.run('UPDATE recurrences SET username = ? WHERE LOWER(username) = LOWER(?)', [next, old]);
  await db.run('UPDATE recurrences SET assignedBy = ? WHERE LOWER(assignedBy) = LOWER(?)', [next, old]);
  await db.run('DELETE FROM presence WHERE LOWER(username) = LOWER(?)', [old]);
  // A repeating shared task remembers its participants: they follow the rename too.
  const series = await db.all<{ id: string; participants: string }[]>('SELECT id, participants FROM recurrences WHERE participants IS NOT NULL');
  for (const r of series) {
    const people: string[] = JSON.parse(r.participants || '[]');
    if (people.some(p => p.toLowerCase() === old.toLowerCase())) {
      await db.run('UPDATE recurrences SET participants = ? WHERE id = ?', [JSON.stringify(people.map(p => (p.toLowerCase() === old.toLowerCase() ? next : p))), r.id]);
    }
  }
  const teams = await db.all<{ id: string; memberUsernames: string }[]>('SELECT id, memberUsernames FROM teams');
  for (const t of teams) {
    const members: string[] = JSON.parse(t.memberUsernames || '[]');
    if (members.some(m => m.toLowerCase() === old.toLowerCase())) {
      await db.run('UPDATE teams SET memberUsernames = ? WHERE id = ?', [
        JSON.stringify(members.map(m => (m.toLowerCase() === old.toLowerCase() ? next : m))),
        t.id,
      ]);
    }
  }
}
