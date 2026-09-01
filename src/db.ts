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
}

export interface User {
  username: string;
  fullName?: string;
  role?: 'admin' | 'user';
  lastLogin: string;
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

export const loginUser = async (username: string, fullName?: string, role?: 'admin' | 'user'): Promise<User> => {
  const user: User = { username, fullName, role, lastLogin: new Date().toISOString() };
  socket.emit('user:login', { username, fullName, role });
  return user;
};

export const createUserByAdmin = async (username: string, fullName: string, role: 'admin' | 'user'): Promise<void> => {
  socket.emit('user:create', { username, fullName, role });
};

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
