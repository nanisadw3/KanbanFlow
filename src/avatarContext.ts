import { createContext, useContext } from 'react';
import { avatarUrl } from './db';
import type { User } from './db';

// Lets any <Avatar> identify a person from just the name it was given. Avatars receive either a
// username ("Inaki") or a full name ("Iñaki Sobera Sotomayor") depending on the screen, so the lookup
// knows both. It gives back the person's photo and their display name, so the same person always
// shows the same initials (IS, never IN on one screen and IS on another).
export interface AvatarPerson {
  photo?: string;
  label: string; // full name when they have one, else the username
}
export type PersonLookup = (name: string) => AvatarPerson | undefined;

export const AvatarPhotosContext = createContext<PersonLookup>(() => undefined);

export const useAvatarPerson = (name: string): AvatarPerson | undefined => useContext(AvatarPhotosContext)(name);

export function buildPersonLookup(users: User[]): PersonLookup {
  const byName = new Map<string, AvatarPerson>();
  for (const u of users) {
    const person: AvatarPerson = { photo: avatarUrl(u), label: u.fullName?.trim() || u.username };
    byName.set(u.username.toLowerCase(), person);
    if (u.fullName?.trim()) byName.set(u.fullName.trim().toLowerCase(), person);
  }
  return name => byName.get(name.trim().toLowerCase());
}
