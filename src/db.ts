import { io, Socket } from 'socket.io-client';
import type { TaskKind, Repeat } from './taskKinds';

export interface Activity {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  status: 'todo' | 'doing' | 'done' | 'cancelled';
  username: string;
  createdAt: string;
  assignedBy?: string;
  priority: 'alta' | 'media' | 'baja';
  progress?: number;
  teamId?: string;
  completedAt?: string;
  archived?: boolean;
  overdueNotifiedAt?: string | null;
  // 'single' unless it is one copy of a shared task (sharedId links all copies) or an
  // occurrence of a repeating one (seriesId; `repeat` says how often). Old rows have no kind.
  kind?: TaskKind;
  sharedId?: string;
  seriesId?: string;
  repeat?: Repeat;
  // Which day a repeating task comes back: weekday 1-5 (weekly/biweekly) or day of the month; month 1-12 only for yearly.
  repeatDay?: number;
  repeatMonth?: number;
}

export interface TaskComment {
  id: string;
  sharedId: string;
  username: string;
  text: string;
  createdAt: string;
}

// When a person last opened a shared task's comments (drives the "new comments" badge).
export interface CommentRead {
  username: string;
  sharedId: string;
  lastReadAt: string;
}

export interface User {
  username: string;
  fullName?: string;
  role?: 'admin' | 'user';
  lastLogin: string;
  email?: string | null;
  // When the profile photo last changed (null/absent = no photo). The image itself is at avatarUrl().
  photoUpdatedAt?: string | null;
}

export interface Team {
  id: string;
  name: string;
  memberUsernames: string[];
  createdAt: string;
}

export interface PresenceEntry {
  username: string;
  context: string;
  lastSeen: number;
}

export type Unsubscribe = () => void;

// In dev, Vite (5173) and the API server (3001) run on different ports, so
// default to the API's port explicitly. In a production build (e.g. the
// single-container Docker image, where Express serves both the API and the
// built frontend from one origin) default to same-origin instead — a
// hardcoded localhost:3001 would be wrong for any real deployment domain.
// VITE_BACKEND_URL overrides this in either case, e.g. for a split deploy.
const SERVER_URL = import.meta.env.VITE_BACKEND_URL
  || (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);

export const socket: Socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: true,
});

// --- Subscriptions --------------------------------------------------------

// The server only pushes each `*:all` snapshot on connect and after a
// mutation — it doesn't replay it for a listener that subscribes later (e.g.
// StatsPage, mounted only once the user navigates to #stats, well after the
// initial connection burst). Without this cache, a component that subscribes
// after that burst sees nothing until the next unrelated change happens
// elsewhere. Caching the latest snapshot per event and replaying it
// synchronously to new subscribers restores the "always get current state on
// subscribe" guarantee that every `subscribe*` below relies on.
function createCachedSubscription<T>(event: string): (cb: (data: T) => void) => Unsubscribe {
  let cached: T | null = null;
  socket.on(event, (data: T) => { cached = data; });
  return (cb: (data: T) => void) => {
    const handler = (data: T) => cb(data);
    socket.on(event, handler);
    if (cached !== null) cb(cached);
    return () => {
      socket.off(event, handler);
    };
  };
}

export const subscribeActivities = createCachedSubscription<Activity[]>('activities:all');
export const subscribeUsers = createCachedSubscription<User[]>('users:all');
export const subscribeTeams = createCachedSubscription<Team[]>('teams:all');
export const subscribePresence = createCachedSubscription<PresenceEntry[]>('presence:all');
export const subscribeComments = createCachedSubscription<TaskComment[]>('comments:all');
export const subscribeCommentReads = createCachedSubscription<CommentRead[]>('commentReads:all');

// Announcements shown as a banner: 'normal' ones (any admin, they expire) and the 'maintenance' one (Inaki only).
export interface Notice {
  id: string;
  kind: 'normal' | 'maintenance';
  message: string;
  createdAt: string;
  expiresAt: string | null;
  createdBy: string;
}
export const subscribeNotices = createCachedSubscription<Notice[]>('notices:all');

export const PRESENCE_STALE_MS = 20_000;
export const isPresenceFresh = (entry: PresenceEntry, now = Date.now()) =>
  now - entry.lastSeen < PRESENCE_STALE_MS;

// --- Activities CRUD ------------------------------------------------------

export const addActivity = async (activity: Omit<Activity, 'id' | 'createdAt'>): Promise<void> => {
  socket.emit('activity:add', activity);
};

export interface SharedTaskInput {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  priority: Activity['priority'];
  usernames: string[];
  assignedBy: string;
  teamId?: string;
  // A shared task that also repeats: every cycle it is created again for the same people.
  repeat?: Repeat;
  repeatDay?: number;
  repeatMonth?: number;
}

export const addSharedActivity = (payload: SharedTaskInput): Promise<AuthResult> =>
  emitWithAck('activity:addShared', payload);

export const addComment = (sharedId: string, username: string, text: string): Promise<AuthResult> =>
  emitWithAck('comment:add', { sharedId, username, text });

// Marks a shared task's comments as read for that person (fire and forget; the server broadcasts the mark).
export const markCommentsRead = async (username: string, sharedId: string): Promise<void> => {
  socket.emit('comments:read', { username, sharedId });
};

// Adds/removes people on a shared task. `by` is who is making the change. Anyone not listed loses
// their copy (and progress); new people get a fresh copy at 0%.
export const setSharedParticipants = (sharedId: string, usernames: string[], by: string): Promise<AuthResult> =>
  emitWithAck('shared:setParticipants', { sharedId, usernames, by });

// Turns a task into another type without re-creating it. A task is two switches, shared and repeating
// (neither = individual). Leaving "shared" deletes the other people's copies; leaving "repeating"
// stops the series.
export interface ChangeKindInput {
  id: string;
  shared: boolean;
  repeating: boolean;
  by: string;
  usernames?: string[];
  repeat?: Activity['repeat'];
  repeatDay?: number;
  repeatMonth?: number;
  fields: { title: string; description: string; startDate: string; endDate: string; priority: Activity['priority'] };
}
export const changeTaskKind = (payload: ChangeKindInput): Promise<AuthResult> =>
  emitWithAck('activity:changeKind', payload);

// Stops a repeating task from generating more occurrences (the existing ones stay as normal tasks).
export const stopSeries = async (activityId: string): Promise<void> => {
  socket.emit('series:stop', activityId);
};

// Changes when a repeating task (or rutina) repeats. Occurrences already created keep their dates.
export const setSeriesRule = (payload: { id: string; by: string; repeat: Repeat; repeatDay?: number; repeatMonth?: number }): Promise<AuthResult> =>
  emitWithAck('series:setRule', payload);

export const updateActivityStatus = async (id: string, status: Activity['status'], progress?: number): Promise<void> => {
  socket.emit('activity:updateStatus', { id, status, progress });
};

// Archives (or restores) several tasks in one go.
export const setActivitiesArchived = async (ids: string[], archived: boolean): Promise<void> => {
  socket.emit('activity:setArchivedMany', { ids, archived });
};

export const setActivityArchived = async (id: string, archived: boolean): Promise<void> => {
  socket.emit('activity:setArchived', { id, archived });
};

export const updateActivity = async (updatedAct: Activity): Promise<void> => {
  socket.emit('activity:update', updatedAct);
};

export const deleteActivity = async (id: string): Promise<void> => {
  socket.emit('activity:delete', id);
};

export const clearUserActivities = async (username: string): Promise<void> => {
  socket.emit('activity:clearUser', username);
};

export const clearTeamActivities = async (teamId: string): Promise<void> => {
  socket.emit('activity:clearTeam', teamId);
};

// --- Users CRUD -----------------------------------------------------------

export const loginUser = async (username: string, fullName?: string, role?: 'admin' | 'user', email?: string): Promise<User> => {
  const user: User = { username, fullName, role, lastLogin: new Date().toISOString() };
  socket.emit('user:login', { username, fullName, email });
  return user;
};

// --- Admin passwords (verified by the server; hashes never reach the client) ---

export type AuthResult = { ok: boolean; username?: string; error?: 'bad_password' | 'too_short' | 'timeout' | 'invalid_email' | 'not_found' | 'exists' | 'invalid_username' | 'invalid_name' | 'forbidden' | 'invalid_role' | 'protected' | 'self' | 'password_required' | 'invalid_title' | 'invalid_dates' | 'no_participants' | 'invalid_comment' | 'invalid_photo' };

const emitWithAck = (event: string, payload: object): Promise<AuthResult> =>
  new Promise(resolve => {
    socket.timeout(8000).emit(event, payload, (err: Error | null, res?: AuthResult) => {
      resolve(err || !res ? { ok: false, error: 'timeout' } : res);
    });
  });

export const loginAdmin = (username: string, password: string): Promise<AuthResult> =>
  emitWithAck('auth:login', { username, password });

export const changeAdminPassword = (username: string, currentPassword: string, newPassword: string): Promise<AuthResult> =>
  emitWithAck('auth:changePassword', { username, currentPassword, newPassword });

// Changing a role needs the admin's username + password, and the server only accepts it from
// the role manager ("Inaki"). Promoting to admin also needs a password for the new admin.
export const setUserRole = (payload: {
  adminUsername: string; adminPassword: string; username: string; role: 'admin' | 'user'; password?: string;
}): Promise<AuthResult> => emitWithAck('user:setRole', payload);

// Publishing or ending an announcement needs the admin's username + password. The server only lets
// the role manager publish/end the 'maintenance' kind. `minutes` is how long a normal one stays up.
// `sendEmail` also mails everyone who has an address.
export const publishNotice = (payload: {
  adminUsername: string; adminPassword: string; kind: Notice['kind']; message?: string; minutes?: number; sendEmail?: boolean;
}): Promise<AuthResult & { emailed?: number; emailSkipped?: string }> => emitWithAck('notice:publish', payload);

export const endNotice = (payload: { adminUsername: string; adminPassword: string; id: string }): Promise<AuthResult> =>
  emitWithAck('notice:end', payload);

// Creating a user needs an admin's username + password; the server verifies them.
export const createUserByAdmin = (payload: {
  adminUsername: string; adminPassword: string;
  username: string; fullName: string; role: 'admin' | 'user'; email: string; password?: string;
}): Promise<AuthResult> => emitWithAck('user:create', payload);

// Where a user's profile photo is served from; the version makes a new photo a new URL.
export const avatarUrl = (u: Pick<User, 'username' | 'photoUpdatedAt'>): string | undefined =>
  u.photoUpdatedAt ? `${SERVER_URL}/api/avatar/${encodeURIComponent(u.username)}?v=${encodeURIComponent(u.photoUpdatedAt)}` : undefined;

// Edits the logged-in user's own profile. `photo`: omit to keep, null to remove, or a data URL.
// An administrator account must send its password. On success the reply has the (possibly new) username.
export const updateProfile = (payload: {
  username: string; password?: string; fullName?: string; newUsername?: string; email?: string; photo?: string | null;
}): Promise<AuthResult> => emitWithAck('profile:update', payload);

export const setUserEmail = (username: string, email: string): Promise<AuthResult> =>
  emitWithAck('user:setEmail', { username, email });

// --- Mail settings (admin panel). The server never sends the client secret or refresh token
// back; changing or testing the settings needs the calling admin's password. ---

export interface MailSettings { clientId: string; from: string; hasClientSecret: boolean; hasRefreshToken: boolean }
export interface MailAck { ok: boolean; error?: string; message?: string; enabled?: boolean; settings?: MailSettings; to?: string }

const askMail = (event: string, payload: object): Promise<MailAck> =>
  new Promise(resolve => {
    socket.timeout(15000).emit(event, payload, (err: Error | null, res?: MailAck) => {
      resolve(err || !res ? { ok: false, error: 'timeout' } : res);
    });
  });

export const getMailSettings = (): Promise<MailAck> => askMail('settings:getMail', {});

export const saveMailSettings = (payload: {
  adminUsername: string; adminPassword: string; clientId: string; clientSecret: string; refreshToken: string; from: string;
}): Promise<MailAck> => askMail('settings:saveMail', payload);

export const testMailSettings = (adminUsername: string, adminPassword: string): Promise<MailAck> =>
  askMail('settings:testMail', { adminUsername, adminPassword });

export const deleteUser = async (username: string): Promise<void> => {
  socket.emit('user:delete', username);
};

// --- Teams CRUD -----------------------------------------------------------

export const createTeam = async (name: string, memberUsernames: string[]): Promise<void> => {
  socket.emit('team:create', { name, memberUsernames });
};

export const deleteTeam = async (teamId: string): Promise<void> => {
  socket.emit('team:delete', teamId);
};

// --- Presence -------------------------------------------------------------

export const heartbeat = async (username: string, context: string): Promise<void> => {
  socket.emit('presence:heartbeat', { username, context });
};

export const clearPresence = async (username: string): Promise<void> => {
  socket.emit('presence:clear', username);
};
