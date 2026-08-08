import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  writeBatch,
  arrayRemove,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';

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
  teamId?: string;
  // Set when status becomes 'done', cleared otherwise. Drives the 3-day
  // auto-archive: the live board hides done tasks older than this, but they
  // remain visible in the Historial (see isRecentlyDone in App.tsx).
  completedAt?: string;
}

export interface User {
  username: string;
  lastLogin: string;
}

export interface Team {
  id: string;
  name: string;
  memberUsernames: string[];
  createdAt: string;
}

// Who is looking at what, right now — powers the "who's online" / "viewing
// this board" indicators. `context` is a free-form string such as
// 'admin', 'personal', `user-${username}` (admin supervising someone), or
// `team-${teamId}`. Presence has no server-side expiry (no Realtime
// Database / onDisconnect here), so readers must treat entries with a
// `lastSeen` older than ~20s as stale — see isPresenceFresh().
export interface PresenceEntry {
  username: string;
  context: string;
  lastSeen: number;
}

const COLLECTIONS = {
  ACTIVITIES: 'activities',
  USERS: 'users',
  TEAMS: 'teams',
  PRESENCE: 'presence',
};

const userDocId = (username: string) => username.toLowerCase();

// --- Seed data (first run only) ------------------------------------------

const taskTemplates = [
  { title: 'Revisar código (Code Review)', description: 'Auditar cambios en el repositorio principal y aprobar pull requests.' },
  { title: 'Diseñar base de datos', description: 'Crear esquemas, tablas, índices y relaciones relacionales.' },
  { title: 'Implementar autenticación', description: 'Configurar flujos de inicio de sesión con JWT y Google OAuth.' },
  { title: 'Optimizar rendimiento CSS', description: 'Eliminar reglas de estilos obsoletas y optimizar selectores.' },
  { title: 'Configurar pipeline CI/CD', description: 'Configurar flujos de trabajo automatizados con GitHub Actions.' },
  { title: 'Escribir pruebas unitarias', description: 'Desarrollar tests unitarios usando Vitest y React Testing Library.' },
  { title: 'Actualizar dependencias npm', description: 'Revisar vulnerabilidades con npm audit y subir versiones.' },
  { title: 'Redactar documentación técnica', description: 'Escribir guías de arquitectura y configuración de desarrollo.' },
  { title: 'Corregir bugs de UI', description: 'Ajustar alineación de layouts, espaciados y problemas responsivos.' },
  { title: 'Diseñar landing page', description: 'Elaborar wireframes y prototipos interactivos en Figma.' },
  { title: 'Configurar servidor web', description: 'Configurar proxies inversos y certificados SSL en Nginx.' },
  { title: 'Pruebas de carga y estrés', description: 'Verificar estabilidad del backend bajo concurrencia con k6.' },
  { title: 'Monitoreo de excepciones', description: 'Configurar alertas y reportar fallos a través de Sentry.' },
  { title: 'Refactorizar estados React', description: 'Migrar prop drilling obsoleto hacia contextos de React.' },
  { title: 'Integrar pasarela de pagos', description: 'Conectar APIs de Stripe para procesamiento de suscripciones.' },
];

const defaultUsernames = [
  'Sofia', 'Mateo', 'Valentina', 'Sebastian', 'Camila', 'Alejandro', 'Isabella',
  'Santiago', 'Mariana', 'Nicolas', 'Daniela', 'Samuel', 'Valeria', 'Lucas',
  'Gabriela', 'Benjamin', 'Lucia', 'Emmanuel', 'Andrea', 'Daniel',
];

// Seeds Firebase with demo users/activities the first time the project is
// used (i.e. its `users` collection is empty). Safe to call on every load.
export const initDB = async (): Promise<void> => {
  const usersSnap = await getDocs(collection(db, COLLECTIONS.USERS));
  if (!usersSnap.empty) return;

  const batch = writeBatch(db);
  const now = new Date().toISOString();

  batch.set(doc(db, COLLECTIONS.USERS, 'admin'), { username: 'admin', lastLogin: now });

  defaultUsernames.forEach(username => {
    batch.set(doc(db, COLLECTIONS.USERS, userDocId(username)), { username, lastLogin: now });

    const count = Math.floor(Math.random() * 3) + 2; // 2, 3 or 4 tasks
    const shuffled = [...taskTemplates].sort(() => 0.5 - Math.random());
    const statuses: Activity['status'][] = ['todo', 'doing', 'done'];
    const priorities: Activity['priority'][] = ['alta', 'media', 'baja'];

    shuffled.slice(0, count).forEach((t, index) => {
      const ref = doc(collection(db, COLLECTIONS.ACTIVITIES));
      batch.set(ref, {
        title: t.title,
        description: t.description,
        startDate: `2026-08-0${7 + index}`,
        endDate: `2026-08-1${0 + index}`,
        status: statuses[Math.floor(Math.random() * statuses.length)],
        username,
        createdAt: now,
        priority: priorities[Math.floor(Math.random() * priorities.length)],
        assignedBy: Math.random() > 0.75 ? 'admin' : null,
      });
    });
  });

  await batch.commit();
};

// --- Real-time subscriptions ----------------------------------------------
// Each of these keeps a piece of React state in sync live, across every tab
// and device connected to the same Firebase project — this is what makes
// edits from other people show up immediately.

export const subscribeActivities = (cb: (activities: Activity[]) => void): Unsubscribe =>
  onSnapshot(collection(db, COLLECTIONS.ACTIVITIES), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Activity)));
  });

export const subscribeUsers = (cb: (users: User[]) => void): Unsubscribe =>
  onSnapshot(collection(db, COLLECTIONS.USERS), snap => {
    cb(snap.docs.map(d => d.data() as User));
  });

export const subscribeTeams = (cb: (teams: Team[]) => void): Unsubscribe =>
  onSnapshot(collection(db, COLLECTIONS.TEAMS), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Team)));
  });

export const subscribePresence = (cb: (entries: PresenceEntry[]) => void): Unsubscribe =>
  onSnapshot(collection(db, COLLECTIONS.PRESENCE), snap => {
    cb(snap.docs.map(d => d.data() as PresenceEntry));
  });

// Presence entries older than this are treated as the tab having gone away
// without a clean sign-out (closed tab, lost connection, crashed browser).
export const PRESENCE_STALE_MS = 20_000;
export const isPresenceFresh = (entry: PresenceEntry, now = Date.now()) =>
  now - entry.lastSeen < PRESENCE_STALE_MS;

// --- Activities -------------------------------------------------------------

export const addActivity = async (activity: Omit<Activity, 'id' | 'createdAt'>): Promise<void> => {
  await addDoc(collection(db, COLLECTIONS.ACTIVITIES), {
    ...activity,
    assignedBy: activity.assignedBy ?? null,
    teamId: activity.teamId ?? null,
    completedAt: activity.status === 'done' ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
  });
};

export const updateActivityStatus = async (id: string, status: Activity['status']): Promise<void> => {
  await updateDoc(doc(db, COLLECTIONS.ACTIVITIES, id), {
    status,
    completedAt: status === 'done' ? new Date().toISOString() : null,
  });
};

export const updateActivity = async (updatedAct: Activity): Promise<void> => {
  const { id, ...rest } = updatedAct;
  await setDoc(doc(db, COLLECTIONS.ACTIVITIES, id), {
    ...rest,
    assignedBy: rest.assignedBy ?? null,
    teamId: rest.teamId ?? null,
    completedAt: rest.completedAt ?? null,
  });
};

export const deleteActivity = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, COLLECTIONS.ACTIVITIES, id));
};

export const clearUserActivities = async (username: string): Promise<void> => {
  const snap = await getDocs(collection(db, COLLECTIONS.ACTIVITIES));
  const batch = writeBatch(db);
  snap.docs
    .filter(d => (d.data().username as string).toLowerCase() === username.toLowerCase())
    .forEach(d => batch.delete(d.ref));
  await batch.commit();
};

export const clearTeamActivities = async (teamId: string): Promise<void> => {
  const snap = await getDocs(collection(db, COLLECTIONS.ACTIVITIES));
  const batch = writeBatch(db);
  snap.docs
    .filter(d => d.data().teamId === teamId)
    .forEach(d => batch.delete(d.ref));
  await batch.commit();
};

// --- Users --------------------------------------------------------------

export const loginUser = async (username: string): Promise<User> => {
  const user: User = { username, lastLogin: new Date().toISOString() };
  await setDoc(doc(db, COLLECTIONS.USERS, userDocId(username)), user, { merge: true });
  return user;
};

export const deleteUser = async (username: string): Promise<void> => {
  await deleteDoc(doc(db, COLLECTIONS.USERS, userDocId(username)));
  await clearUserActivities(username);

  // Drop the user from any team they were part of.
  const teamsSnap = await getDocs(collection(db, COLLECTIONS.TEAMS));
  const batch = writeBatch(db);
  teamsSnap.docs.forEach(d => {
    const members = (d.data().memberUsernames as string[]) || [];
    if (members.some(m => m.toLowerCase() === username.toLowerCase())) {
      batch.update(d.ref, { memberUsernames: arrayRemove(...members.filter(m => m.toLowerCase() === username.toLowerCase())) });
    }
  });
  await batch.commit();
};

// --- Teams ----------------------------------------------------------------

export const createTeam = async (name: string, memberUsernames: string[]): Promise<void> => {
  await addDoc(collection(db, COLLECTIONS.TEAMS), {
    name,
    memberUsernames,
    createdAt: new Date().toISOString(),
  });
};

export const deleteTeam = async (teamId: string): Promise<void> => {
  await deleteDoc(doc(db, COLLECTIONS.TEAMS, teamId));
  await clearTeamActivities(teamId);
};

// --- Presence ---------------------------------------------------------------

export const heartbeat = async (username: string, context: string): Promise<void> => {
  const entry: PresenceEntry = { username, context, lastSeen: Date.now() };
  await setDoc(doc(db, COLLECTIONS.PRESENCE, userDocId(username)), entry);
};

export const clearPresence = async (username: string): Promise<void> => {
  await deleteDoc(doc(db, COLLECTIONS.PRESENCE, userDocId(username)));
};
