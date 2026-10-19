import { io, Socket } from 'socket.io-client';

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
}

export interface User {
  username: string;
  fullName?: string;
  role?: 'admin' | 'user';
  lastLogin: string;
  email?: string | null;
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

export const initDB = async (): Promise<void> => {
  // Database is automatically initialized & seeded on server startup.
  return Promise.resolve();
};

// --- Subscriptions --------------------------------------------------------

// The server only pushes each `*:all` snapshot on connect and after a
// mutation — it doesn't replay it for a listener that subscribes later (e.g.
// StatsPage, mounted only once the user navigates to #stats, well after the
// initial connection burst). Without this cache, a component that subscribes
// after that burst sees nothing until the next unrelated change happens
// elsewhere. Caching the latest snapshot per event and replaying it
// synchronously to new subscribers restores the "always get current state on
// subscribe" guarantee the old Firestore onSnapshot-based subscriptions gave
// for free.
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

export const PRESENCE_STALE_MS = 20_000;
export const isPresenceFresh = (entry: PresenceEntry, now = Date.now()) =>
  now - entry.lastSeen < PRESENCE_STALE_MS;

// --- Activities CRUD ------------------------------------------------------

export const addActivity = async (activity: Omit<Activity, 'id' | 'createdAt'>): Promise<void> => {
  socket.emit('activity:add', activity);
};

export const updateActivityStatus = async (id: string, status: Activity['status'], progress?: number): Promise<void> => {
  socket.emit('activity:updateStatus', { id, status, progress });
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

export type AuthResult = { ok: boolean; error?: 'bad_password' | 'too_short' | 'timeout' | 'invalid_email' | 'not_found' | 'exists' | 'invalid_username' | 'invalid_name' };

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

// Creating a user needs an admin's username + password; the server verifies them.
export const createUserByAdmin = (payload: {
  adminUsername: string; adminPassword: string;
  username: string; fullName: string; role: 'admin' | 'user'; email: string; password?: string;
}): Promise<AuthResult> => emitWithAck('user:create', payload);

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
