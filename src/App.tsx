import { useState, useEffect, useRef } from 'react';
import {
  initDB,
  subscribeActivities,
  subscribeUsers,
  subscribeTeams,
  subscribePresence,
  loginUser,
  createUserByAdmin,
  addActivity,
  updateActivityStatus,
  updateActivity,
  deleteActivity,
  deleteUser,
  clearUserActivities,
  createTeam,
  deleteTeam,
  clearTeamActivities,
  heartbeat,
  clearPresence,
  isPresenceFresh,
} from './db';
import type { Activity, User, Team, PresenceEntry } from './db';
// Using Material Symbols Rounded via Google Fonts, no Lucide React imports needed
import './App.css';
import StatsPage from './StatsPage';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullNameInput, setFullNameInput] = useState('');
  const [isNewUserPrompt, setIsNewUserPrompt] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [currentView, setCurrentView] = useState<'board' | 'stats'>('board');

  // Kanban and Activities state — kept live by Firestore subscriptions, see
  // the sync effect below, so edits from any other tab/device appear here
  // automatically without any manual refresh.
  const [activities, setActivities] = useState<Activity[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<'todo' | 'doing' | 'done' | 'cancelled' | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<'todo' | 'doing' | 'done' | 'cancelled'>('todo');
  const [priority, setPriority] = useState<'alta' | 'media' | 'baja'>('media');
  const [progress, setProgress] = useState<number>(50);
  const [targetAssignee, setTargetAssignee] = useState<string>('');  // Admin filter
  const [viewingUserAsAdmin, setViewingUserAsAdmin] = useState<User | null>(null);
  const [activeStatusFilters, setActiveStatusFilters] = useState<Set<'todo' | 'doing' | 'done' | 'cancelled'>>(new Set());
  const [activeUserFilters, setActiveUserFilters] = useState<Set<string>>(new Set());
  const [isUsersPanelOpen, setIsUsersPanelOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');

  // Admin Create User Modal State
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [newUsernameInput, setNewUsernameInput] = useState('');
  const [newFullNameInput, setNewFullNameInput] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');
  const [createUserError, setCreateUserError] = useState('');

  // Teams state
  const [teams, setTeams] = useState<Team[]>([]);
  const [viewingTeam, setViewingTeam] = useState<Team | null>(null);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [teamNameInput, setTeamNameInput] = useState('');
  const [teamMemberSelection, setTeamMemberSelection] = useState<Set<string>>(new Set());
  const [teamMemberSearch, setTeamMemberSearch] = useState('');

  // Presence — who else is looking at the app right now, and where.
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [presenceTick, setPresenceTick] = useState(0); // forces re-evaluation of staleness even with no new writes

  // History of completed tasks
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // Drag-to-trash cancel gesture: the trash zone stays hidden and only
  // reveals itself (as a floating bar at the bottom) once a card has been
  // held mid-drag for a beat — it never sits on screen as a permanent area.
  const [isTrashZoneVisible, setIsTrashZoneVisible] = useState(false);
  const [isTrashHovering, setIsTrashHovering] = useState(false);
  const [trashBurst, setTrashBurst] = useState(false);
  const trashRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards the reveal timer below: if a drag ends (drop or dragend) before
  // the 550ms delay elapses, the timer can still fire afterwards — without
  // this check it would resurrect the trash button with no drag left to
  // hide it again.
  const isDraggingRef = useRef(false);

  // Theme state
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });

  // Custom Confirmation Modal State
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmConfig({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleSelectUser = (u: User | null) => {
    setViewingUserAsAdmin(u);
    setViewingTeam(null);
    if (u) {
      window.location.hash = `user-${encodeURIComponent(u.username)}`;
    } else {
      window.history.pushState(null, '', window.location.pathname);
    }
  };

  const handleSelectTeam = (t: Team | null) => {
    setViewingTeam(t);
    setViewingUserAsAdmin(null);
    if (t) {
      window.location.hash = `team-${encodeURIComponent(t.id)}`;
    } else {
      window.history.pushState(null, '', window.location.pathname);
    }
  };

  // Refs mirroring the latest users/teams so the hash-routing listener below
  // (registered once, on mount) can look up fresh data without needing to
  // re-subscribe to the hashchange event every time users/teams update.
  const usersRef = useRef<User[]>([]);
  const teamsRef = useRef<Team[]>([]);
  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => { teamsRef.current = teams; }, [teams]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#stats') {
        setCurrentView('stats');
      } else if (hash.startsWith('#user-')) {
        setCurrentView('board');
        const userName = decodeURIComponent(hash.substring(6));
        const foundUser = usersRef.current.find(u => u.username.toLowerCase() === userName.toLowerCase());
        setViewingUserAsAdmin(foundUser || null);
        setViewingTeam(null);
      } else if (hash.startsWith('#team-')) {
        setCurrentView('board');
        const teamId = decodeURIComponent(hash.substring(6));
        const foundTeam = teamsRef.current.find(t => t.id === teamId);
        setViewingTeam(foundTeam || null);
        setViewingUserAsAdmin(null);
      } else {
        setCurrentView('board');
        setViewingUserAsAdmin(null);
        setViewingTeam(null);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Real-time data sync: seeds Firebase once if empty, then subscribes to
  // live updates for activities/users/teams/presence. Every write anyone
  // makes (any tab, any device, same Firebase project) flows back through
  // these listeners automatically — this is what makes the whole app
  // multi-user in real time instead of just localStorage-per-browser.
  useEffect(() => {
    void initDB();
    const unsubActivities = subscribeActivities(setActivities);
    const unsubUsers = subscribeUsers(setUsers);
    const unsubTeams = subscribeTeams(setTeams);
    const unsubPresence = subscribePresence(setPresence);
    return () => {
      unsubActivities();
      unsubUsers();
      unsubTeams();
      unsubPresence();
    };
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.add('light-theme');
      document.body.classList.remove('dark-theme');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Lock background scroll while any modal is open, so the modal is always
  // immediately visible instead of requiring the page to be scrolled first.
  useEffect(() => {
    const anyModalOpen = isModalOpen || isTeamModalOpen || isCreateUserModalOpen || confirmConfig.isOpen;
    document.body.style.overflow = anyModalOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isModalOpen, isTeamModalOpen, isCreateUserModalOpen, confirmConfig.isOpen]);

  // Presence heartbeats never stop ticking on their own, so we also refresh
  // this every few seconds purely to re-check which entries have gone stale.
  useEffect(() => {
    const t = setInterval(() => setPresenceTick(x => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  // Briefly plays the trash "burst" animation after a task is cancelled.
  useEffect(() => {
    if (!trashBurst) return;
    const t = setTimeout(() => setTrashBurst(false), 600);
    return () => clearTimeout(t);
  }, [trashBurst]);

  // Safety net: the browser always fires a native 'dragend' when a drag
  // operation finishes, even if the dragged card's own onDragEnd never runs
  // (e.g. a live Firestore update re-renders/unmounts the card mid-drag,
  // detaching it from the tree before React's delegated listener can catch
  // the event). Without this, the trash button can get stuck visible.
  useEffect(() => {
    const resetTrashDragState = () => {
      isDraggingRef.current = false;
      if (trashRevealTimerRef.current) {
        clearTimeout(trashRevealTimerRef.current);
        trashRevealTimerRef.current = null;
      }
      setIsTrashZoneVisible(false);
      setIsTrashHovering(false);
      setDraggedId(null);
      setDragOverColumn(null);
    };
    window.addEventListener('dragend', resetTrashDragState);
    return () => window.removeEventListener('dragend', resetTrashDragState);
  }, []);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };



  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setUsernameInput(val);
    setIsNewUserPrompt(false);
    setFullNameInput('');
    if (val.toLowerCase() === 'admin') {
      setShowPassword(true);
    } else {
      setShowPassword(false);
      setPasswordInput('');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanUsername = usernameInput.trim();
    if (!cleanUsername) {
      setErrorMsg('Por favor introduce tu nombre de usuario');
      return;
    }

    if (cleanUsername.toLowerCase() === 'admin') {
      if (passwordInput !== 'admin') {
        setErrorMsg('Contraseña de administrador incorrecta');
        return;
      }
      const loggedIn = await loginUser(cleanUsername);
      setUser(loggedIn);
      return;
    }

    const existingUser = users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());

    if (!existingUser && !isNewUserPrompt) {
      setIsNewUserPrompt(true);
      return;
    }

    if (isNewUserPrompt) {
      if (!fullNameInput.trim()) {
        setErrorMsg('Por favor escribe tu Nombre y Apellido');
        return;
      }
    }

    const loggedIn = await loginUser(
      cleanUsername, 
      isNewUserPrompt ? fullNameInput.trim() : existingUser?.fullName,
      existingUser?.role || (cleanUsername.toLowerCase() === 'admin' ? 'admin' : 'user')
    );
    setUser(loggedIn);
    setIsNewUserPrompt(false);
    setFullNameInput('');
  };

  const openCreateUserModal = () => {
    setNewUsernameInput('');
    setNewFullNameInput('');
    setNewUserRole('user');
    setCreateUserError('');
    setIsCreateUserModalOpen(true);
  };

  const handleSaveNewUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateUserError('');

    const cleanUsername = newUsernameInput.trim();
    const cleanFullName = newFullNameInput.trim();

    if (!cleanUsername || !cleanFullName) {
      setCreateUserError('Nombre de usuario y Nombre/Apellido son requeridos.');
      return;
    }

    const exists = users.some(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
    if (exists) {
      setCreateUserError('El nombre de usuario ya está registrado.');
      return;
    }

    await createUserByAdmin(cleanUsername, cleanFullName, newUserRole);
    setIsCreateUserModalOpen(false);
  };

  const handleLogout = () => {
    if (user) void clearPresence(user.username);
    setUser(null);
    setUsernameInput('');
    setPasswordInput('');
    setFullNameInput('');
    setIsNewUserPrompt(false);
    setShowPassword(false);
    handleSelectUser(null);
  };

  const handleDeleteUser = (usernameToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening their dashboard
    showConfirm(
      'Eliminar Usuario',
      `¿Estás seguro de que deseas eliminar al usuario "${usernameToDelete}" y todas sus actividades asociadas?`,
      async () => {
        await deleteUser(usernameToDelete);
        if (viewingUserAsAdmin?.username.toLowerCase() === usernameToDelete.toLowerCase()) {
          handleSelectUser(null);
        }
      }
    );
  };

  const handleDeleteTeam = (teamId: string, teamName: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening the team board
    showConfirm(
      'Eliminar Equipo',
      `¿Estás seguro de que deseas eliminar el equipo "${teamName}" y todas sus tareas compartidas?`,
      async () => {
        await deleteTeam(teamId);
        if (viewingTeam?.id === teamId) {
          handleSelectTeam(null);
        }
      }
    );
  };

  const openCreateTeamModal = () => {
    setTeamNameInput('');
    setTeamMemberSelection(new Set());
    setTeamMemberSearch('');
    setIsTeamModalOpen(true);
  };

  const toggleTeamMember = (username: string) => {
    setTeamMemberSelection(prev => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  };

  const handleSaveTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamNameInput.trim() || teamMemberSelection.size === 0) return;
    await createTeam(teamNameInput.trim(), [...teamMemberSelection]);
    setIsTeamModalOpen(false);
  };

  // Drag and Drop
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id);

    // Add dragging styling to current target
    const target = e.currentTarget as HTMLElement;
    target.classList.add('dragging');

    // The trash zone stays hidden until the card has been held mid-drag
    // for a beat — it should feel like it appears out of nowhere, not sit
    // on screen the whole time.
    isDraggingRef.current = true;
    if (trashRevealTimerRef.current) clearTimeout(trashRevealTimerRef.current);
    trashRevealTimerRef.current = setTimeout(() => {
      if (isDraggingRef.current) setIsTrashZoneVisible(true);
    }, 550);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.classList.remove('dragging');
    isDraggingRef.current = false;
    setDraggedId(null);
    setDragOverColumn(null);
    if (trashRevealTimerRef.current) {
      clearTimeout(trashRevealTimerRef.current);
      trashRevealTimerRef.current = null;
    }
    setIsTrashZoneVisible(false);
    setIsTrashHovering(false);
  };

  const handleDragOver = (e: React.DragEvent, colStatus: 'todo' | 'doing' | 'done' | 'cancelled') => {
    e.preventDefault();
    setDragOverColumn(colStatus);
  };

  const handleDrop = (e: React.DragEvent, colStatus: 'todo' | 'doing' | 'done' | 'cancelled') => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || draggedId;
    if (id) {
      const activity = activities.find(a => a.id === id);
      void updateActivityStatus(id, colStatus, activity?.progress);
    }
    // Don't rely on the native 'dragend' event to clean up the trash-zone UI here:
    // a status change can re-render the board (moving this card to a new column's
    // list) before the browser dispatches 'dragend' on the now-detached source
    // node, and a detached node's event never bubbles to the window-level safety
    // net — leaving the "Suelta aquí para cancelar" button stuck visible.
    isDraggingRef.current = false;
    if (trashRevealTimerRef.current) {
      clearTimeout(trashRevealTimerRef.current);
      trashRevealTimerRef.current = null;
    }
    setIsTrashZoneVisible(false);
    setIsTrashHovering(false);
    setDraggedId(null);
    setDragOverColumn(null);
  };

  const handleRequestCancelActivity = (id: string) => {
    const activity = activities.find(a => a.id === id);
    showConfirm(
      'Cancelar Tarea',
      `¿Deseas desechar "${activity?.title || 'esta tarea'}"? Se marcará como cancelada.`,
      async () => {
        await updateActivityStatus(id, 'cancelled');
        setTrashBurst(true);
      }
    );
  };

  const handleTrashDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsTrashHovering(true);
  };

  const handleTrashDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleTrashDragLeave = () => {
    setIsTrashHovering(false);
  };

  const handleTrashDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || draggedId;
    if (id) {
      handleRequestCancelActivity(id);
    }
    isDraggingRef.current = false;
    setIsTrashZoneVisible(false);
    setIsTrashHovering(false);
    setDraggedId(null);
  };

  // Modals
  const openCreateModal = (assignee?: string) => {
    setModalMode('create');
    setTitle('');
    setDescription('');
    setStartDate(new Date().toISOString().split('T')[0]);
    setEndDate(new Date().toISOString().split('T')[0]);
    setStatus('todo');
    setPriority('media');
    setProgress(50);
    const defaultAssignee = assignee
      || viewingUserAsAdmin?.username
      || (viewingTeam
          ? (viewingTeam.memberUsernames.find(m => m.toLowerCase() === user?.username.toLowerCase()) || viewingTeam.memberUsernames[0] || '')
          : (user ? user.username : ''));
    setTargetAssignee(defaultAssignee);
    setIsModalOpen(true);
  };

  const openEditModal = (activity: Activity) => {
    setModalMode('edit');
    setSelectedActivity(activity);
    setTitle(activity.title);
    setDescription(activity.description);
    setStartDate(activity.startDate);
    setEndDate(activity.endDate);
    setStatus(activity.status);
    setPriority(activity.priority);
    setProgress(activity.progress ?? (activity.status === 'done' ? 100 : activity.status === 'doing' ? 50 : 0));
    setTargetAssignee(activity.username);
    setIsModalOpen(true);
  };

  const handleSaveActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startDate || !endDate || !user) return;

    const assignee = targetAssignee || user.username;
    // Only note "assigned by" when someone assigns the task to a different
    // person than themselves — self-created tasks don't need the badge.
    const assignedBy = assignee.toLowerCase() !== user.username.toLowerCase() ? user.username : undefined;

    const calculatedProgress = status === 'done' ? 100 : status === 'todo' ? 0 : progress;

    if (modalMode === 'create') {
      await addActivity({
        title,
        description,
        startDate,
        endDate,
        status,
        priority,
        progress: calculatedProgress,
        username: assignee,
        assignedBy,
        teamId: viewingTeam ? viewingTeam.id : undefined
      });
    } else if (modalMode === 'edit' && selectedActivity) {
      const updatedAct: Activity = {
        ...selectedActivity,
        title,
        description,
        startDate,
        endDate,
        status,
        priority,
        progress: calculatedProgress,
        username: assignee,
        assignedBy,
      };
      await updateActivity(updatedAct);
    }

    setIsModalOpen(false);
  };

  const handleDeleteActivity = (id: string) => {
    showConfirm(
      'Eliminar Actividad',
      '¿Estás seguro de que quieres eliminar esta actividad?',
      async () => {
        await deleteActivity(id);
        setIsModalOpen(false);
      }
    );
  };

  const handleClearBoard = () => {
    if (viewingTeam) {
      const teamId = viewingTeam.id;
      const teamName = viewingTeam.name;
      showConfirm(
        'Limpiar Tablero de Equipo',
        `Esto eliminará permanentemente todas las tareas compartidas del equipo "${teamName}". Esta acción no se puede deshacer.`,
        async () => {
          await clearTeamActivities(teamId);
        }
      );
    } else {
      const username = viewingUserAsAdmin?.username || user!.username;
      showConfirm(
        'Limpiar Tablero',
        `Esto eliminará permanentemente todas las actividades de ${username}. Esta acción no se puede deshacer.`,
        async () => {
          await clearUserActivities(username);
        }
      );
    }
  };

  // Filter activities based on user role and selected filter
  const isAdmin = user?.username.toLowerCase() === 'admin' || user?.role === 'admin';

  // Send a heartbeat every few seconds saying "I'm here, looking at X" —
  // this is what powers the online/viewing indicators. Presence has no
  // server-side expiry, so readers filter by lastSeen freshness instead.
  useEffect(() => {
    if (!user) return;
    const context = viewingTeam
      ? `team-${viewingTeam.id}`
      : viewingUserAsAdmin
        ? `user-${viewingUserAsAdmin.username}`
        : isAdmin
          ? 'admin'
          : 'personal';

    void heartbeat(user.username, context);
    const interval = setInterval(() => void heartbeat(user.username, context), 8000);
    return () => clearInterval(interval);
  }, [user, viewingTeam, viewingUserAsAdmin, isAdmin]);

  const myTeams = user ? teams.filter(t => t.memberUsernames.some(m => m.toLowerCase() === user.username.toLowerCase())) : [];

  const displayedActivities = viewingTeam
    ? activities.filter(a => a.teamId === viewingTeam.id)
    : isAdmin
      ? (viewingUserAsAdmin
          ? activities.filter(a => a.username.toLowerCase() === viewingUserAsAdmin.username.toLowerCase() && !a.teamId)
          : activities.filter(a => !a.teamId)
        )
      : activities.filter(a => a.username.toLowerCase() === user?.username.toLowerCase() && !a.teamId);

  // Who's online right now (presence entries seen in the last ~20s), and —
  // when viewing a team board — which of them are looking at this same
  // board with you.
  void presenceTick; // re-evaluate staleness on the periodic tick even without new presence writes
  const now = Date.now();
  const onlineNow = presence.filter(p => isPresenceFresh(p, now));
  const teamViewers = viewingTeam
    ? onlineNow.filter(p => p.context === `team-${viewingTeam.id}` && p.username.toLowerCase() !== user?.username.toLowerCase())
    : [];

  // A completed task stays on the live board for 1 day, then quietly
  // drops off it (it still exists — see the Historial modal). Tasks
  // without a completedAt yet (older data) stay visible until they get one.
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const isDoneVisibleOnBoard = (a: Activity) =>
    !a.completedAt || now - new Date(a.completedAt).getTime() < ONE_DAY_MS;

  // Every completed task for the current context (personal/team/supervised
  // user), newest first — this is the full Historial, not just the last day.
  const historyActivities = displayedActivities
    .filter(a => a.status === 'done')
    .sort((a, b) => new Date(b.completedAt || b.createdAt).getTime() - new Date(a.completedAt || a.createdAt).getTime());

  // Count helper
  const getCount = (statusType: 'todo' | 'doing' | 'done' | 'cancelled') => {
    if (statusType === 'done') {
      return displayedActivities.filter(a => a.status === 'done' && isDoneVisibleOnBoard(a)).length;
    }
    return displayedActivities.filter(a => a.status === statusType).length;
  };

  // Toggle a status filter chip on the admin dashboard
  const toggleStatusFilter = (statusType: 'todo' | 'doing' | 'done' | 'cancelled') => {
    setActiveStatusFilters(prev => {
      const next = new Set(prev);
      if (next.has(statusType)) {
        next.delete(statusType);
      } else {
        next.add(statusType);
      }
      return next;
    });
  };

  const isStatusShown = (statusType: 'todo' | 'doing' | 'done' | 'cancelled') =>
    activeStatusFilters.size === 0 || activeStatusFilters.has(statusType);

  // Toggle a user filter chip on the admin dashboard
  const toggleUserFilter = (username: string) => {
    const key = username.toLowerCase();
    setActiveUserFilters(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const isUserShown = (username: string) => {
    const matchesUserFilter = activeUserFilters.size === 0 || activeUserFilters.has(username.toLowerCase());
    if (!matchesUserFilter) return false;

    if (activeStatusFilters.size > 0) {
      const userActs = activities.filter(a => a.username.toLowerCase() === username.toLowerCase() && !a.teamId);
      const hasMatchingActivity = userActs.some(a => activeStatusFilters.has(a.status));
      if (!hasMatchingActivity) return false;
    }

    return true;
  };

  if (!user) {
    return (
      <div className="auth-wrapper">
        <div className="glass-panel auth-card animate-fade-in">
          <h1 className="auth-logo">Kanban<span className="auth-logo-accent">Flow</span></h1>
          <p className="auth-subtitle">Gestiona tus tareas de manera ágil y fluida</p>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Nombre de Usuario</label>
              <input
                type="text"
                className="form-input"
                placeholder="Escribe tu nombre..."
                value={usernameInput}
                onChange={handleUsernameChange}
                required
              />
            </div>

            <div className={`auth-expandable-field ${isNewUserPrompt ? 'is-expanded' : ''}`}>
              <div className="auth-expandable-content">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Nombre y Apellido</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ej. Juan Pérez"
                      value={fullNameInput}
                      onChange={(e) => setFullNameInput(e.target.value)}
                      style={{ paddingLeft: '2.5rem' }}
                      autoFocus={isNewUserPrompt}
                      required={isNewUserPrompt}
                    />
                    <span className="material-symbols-rounded" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '20px' }}>badge</span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                    Usuario nuevo detectado. Por favor ingresa tu Nombre y Apellido para completar tu registro.
                  </p>
                </div>
              </div>
            </div>

            <div className={`auth-expandable-field ${showPassword ? 'is-expanded' : ''}`}>
              <div className="auth-expandable-content">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Contraseña de Admin</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Escribe admin..."
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      style={{ paddingLeft: '2.5rem' }}
                      required={showPassword}
                    />
                    <span className="material-symbols-rounded" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '20px' }}>lock</span>
                  </div>
                </div>
              </div>
            </div>

            {errorMsg && <p className="form-error">{errorMsg}</p>}

            <button type="submit" className="btn btn-primary" style={{ gap: '0.5rem' }}>
              <span className="material-symbols-rounded">{isNewUserPrompt ? 'person_add' : 'login'}</span> {isNewUserPrompt ? 'Registrar y Entrar' : 'Iniciar Sesión'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (currentView === 'stats') {
    return <StatsPage onBack={() => { window.location.hash = ''; }} />;
  }

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <div className="glass-panel board-header animate-fade-in">
        <div className="user-badge">
          <div className="user-avatar">
            {viewingTeam ? <span className="material-symbols-rounded">groups</span> : (isAdmin ? 'AD' : user.username.substring(0, 2).toUpperCase())}
          </div>
          <div className="user-info">
            <h3>{viewingTeam ? viewingTeam.name : (isAdmin ? 'Administrador' : user.username)}</h3>
            <p>{viewingTeam ? `Equipo · ${viewingTeam.memberUsernames.length} miembros` : (isAdmin ? 'Panel de Control General' : 'Tablero Personal')}</p>
          </div>
        </div>

        <div className="header-actions">
          {onlineNow.length > 0 && (
            <div className="online-now" title={`En línea ahora: ${onlineNow.map(p => p.username).join(', ')}`}>
              <span className="online-now-dot" />
              <div className="online-now-avatars">
                {onlineNow.slice(0, 4).map(p => (
                  <span key={p.username} className="team-member-avatar" title={p.username}>{p.username.substring(0, 2).toUpperCase()}</span>
                ))}
                {onlineNow.length > 4 && <span className="team-member-avatar team-member-avatar-more">+{onlineNow.length - 4}</span>}
              </div>
            </div>
          )}
          <button className="btn btn-secondary btn-icon-only" onClick={toggleTheme} title="Cambiar Tema">
            <span className="material-symbols-rounded">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
          </button>
          {(!isAdmin || viewingUserAsAdmin || viewingTeam) && (
            <button className="btn btn-secondary" onClick={() => setIsHistoryModalOpen(true)} style={{ gap: '0.4rem', width: 'auto' }}>
              <span className="material-symbols-rounded">history</span> Historial
            </button>
          )}
          {(!isAdmin || viewingUserAsAdmin || viewingTeam) && (
            <button className="btn btn-danger" onClick={handleClearBoard} style={{ gap: '0.4rem', width: 'auto' }}>
              <span className="material-symbols-rounded">delete_sweep</span> Limpiar
            </button>
          )}
          {isAdmin && !viewingTeam ? (
            <>
              <button className="btn btn-secondary" onClick={openCreateUserModal} style={{ gap: '0.4rem', width: 'auto', whiteSpace: 'nowrap' }}>
                <span className="material-symbols-rounded">person_add</span> Nuevo Usuario
              </button>
              <button className="btn btn-primary" onClick={() => openCreateModal()} style={{ gap: '0.4rem', whiteSpace: 'nowrap' }}>
                <span className="material-symbols-rounded">add</span> Asignar Nueva Tarea
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => openCreateModal()} style={{ gap: '0.4rem' }}>
              <span className="material-symbols-rounded">add</span> {viewingTeam ? 'Nueva Tarea de Equipo' : 'Crear Actividad'}
            </button>
          )}
          <button className="btn btn-secondary btn-icon-only" onClick={handleLogout} title="Cerrar Sesión">
            <span className="material-symbols-rounded">logout</span>
          </button>
        </div>
      </div>

      {!isAdmin && !viewingTeam && myTeams.length > 0 && (
        <div className="my-teams-row animate-fade-in">
          <span className="my-teams-label">Mis equipos:</span>
          {myTeams.map(t => (
            <button key={t.id} type="button" className="team-pill" onClick={() => handleSelectTeam(t)}>
              <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>groups</span> {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Main Panel */}
      {isAdmin && !viewingUserAsAdmin && !viewingTeam ? (
        <div className="admin-dashboard animate-fade-in">
          {/* Admin Stats Grid */}
          <div className="admin-stats-grid">
            <button
              type="button"
              className={`glass-panel stat-card stat-card-users-toggle ${isUsersPanelOpen ? 'is-open' : ''} ${activeUserFilters.size > 0 ? 'is-active' : ''}`}
              onClick={() => setIsUsersPanelOpen(o => !o)}
              aria-expanded={isUsersPanelOpen}
            >
              <div className="stat-icon-box stat-icon-users">
                <span className="material-symbols-rounded" style={{ fontSize: '24px' }}>group</span>
              </div>
              <div className="stat-info">
                <span className="stat-value">{users.length - 1}</span>
                <span className="stat-label">
                  Usuarios
                  {activeUserFilters.size > 0 && ` · ${activeUserFilters.size} activo${activeUserFilters.size > 1 ? 's' : ''}`}
                </span>
              </div>
              <span className="material-symbols-rounded stat-card-users-chevron">
                {isUsersPanelOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {([
              { key: 'todo', icon: 'assignment', label: 'Por Realizar', varColor: '--color-todo', varRgb: '--color-todo-rgb' },
              { key: 'doing', icon: 'schedule', label: 'En Proceso', varColor: '--color-doing', varRgb: '--color-doing-rgb' },
              { key: 'done', icon: 'check_circle', label: 'Completadas', varColor: '--color-done', varRgb: '--color-done-rgb' },
              { key: 'cancelled', icon: 'cancel', label: 'Canceladas', varColor: '--color-danger', varRgb: '--color-danger-rgb' },
            ] as const).map(cfg => {
              const isActive = activeStatusFilters.has(cfg.key);
              const isDimmed = activeStatusFilters.size > 0 && !isActive;
              return (
                <button
                  key={cfg.key}
                  type="button"
                  className={`glass-panel stat-card stat-card-filter ${isActive ? 'is-active' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
                  style={{ ['--filter-color' as string]: `var(${cfg.varColor})`, ['--filter-color-rgb' as string]: `var(${cfg.varRgb})` }}
                  onClick={() => toggleStatusFilter(cfg.key)}
                  aria-pressed={isActive}
                  title={`Filtrar por: ${cfg.label}`}
                >
                  {isActive && (
                    <span className="stat-filter-check">
                      <span className="material-symbols-rounded">check</span>
                    </span>
                  )}
                  <div className={`stat-icon-box stat-icon-${cfg.key}`}>
                    <span className="material-symbols-rounded" style={{ fontSize: '24px' }}>{cfg.icon}</span>
                  </div>
                  <div className="stat-info">
                    <span className="stat-value">{activities.filter(a => a.status === cfg.key && !a.teamId).length}</span>
                    <span className="stat-label">{cfg.label}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {isUsersPanelOpen && (() => {
            const nonAdminUsers = users.filter(u => u.username.toLowerCase() !== 'admin');
            const query = userSearchQuery.trim().toLowerCase();
            const filteredUsers = query
              ? nonAdminUsers.filter(u => (u.fullName || u.username).toLowerCase().includes(query) || u.username.toLowerCase().includes(query))
              : nonAdminUsers;
            return (
              <div className="glass-panel users-panel animate-fade-in">
                <div className="users-panel-toolbar">
                  <div className="users-panel-search">
                    <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>search</span>
                    <input
                      type="text"
                      placeholder="Buscar usuario..."
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="users-panel-actions">
                    <button type="button" onClick={() => setActiveUserFilters(new Set(filteredUsers.map(u => u.username.toLowerCase())))}>
                      Seleccionar {query ? 'resultados' : 'todos'}
                    </button>
                    <button type="button" onClick={() => setActiveUserFilters(new Set())} disabled={activeUserFilters.size === 0}>
                      Ninguno
                    </button>
                  </div>
                </div>

                {filteredUsers.length === 0 ? (
                  <p className="users-panel-empty">Sin resultados para "{userSearchQuery}".</p>
                ) : (
                  <div className="user-chip-grid">
                    {filteredUsers.map(u => {
                      const isActive = activeUserFilters.has(u.username.toLowerCase());
                      const displayName = u.fullName || u.username;
                      return (
                        <div key={u.username} className="user-chip-wrapper">
                          <button
                            type="button"
                            className={`user-chip ${isActive ? 'is-active' : ''}`}
                            onClick={() => toggleUserFilter(u.username)}
                            aria-pressed={isActive}
                            title={`Filtrar por: ${displayName}`}
                          >
                            {displayName}
                          </button>
                          <button
                            type="button"
                            className="user-chip-delete"
                            onClick={(e) => handleDeleteUser(u.username, e)}
                            title={`Eliminar a ${displayName}`}
                          >
                            <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>close</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {(activeStatusFilters.size > 0 || activeUserFilters.size > 0) && (
            <div className="filter-hint animate-fade-in">
              <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>filter_alt</span>
              Mostrando solo:{' '}
              {[
                ...[...activeStatusFilters].map(s => s === 'todo' ? 'Por Realizar' : s === 'doing' ? 'En Proceso' : s === 'done' ? 'Completadas' : 'Canceladas'),
                ...[...activeUserFilters].map(key => {
                  const found = users.find(u => u.username.toLowerCase() === key);
                  return found ? (found.fullName || found.username) : key;
                }),
              ].join(', ')}
              <button type="button" onClick={() => { setActiveStatusFilters(new Set()); setActiveUserFilters(new Set()); }}>Limpiar filtro</button>
            </div>
          )}

          {/* Teams management */}
          <div className="glass-panel activity-map-section">
            <div className="admin-header">
              <div className="activity-map-title">
                <span className="material-symbols-rounded" style={{ fontSize: '24px', color: 'var(--color-secondary)' }}>groups</span>
                <h2>Equipos</h2>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto', gap: '0.4rem' }}
                onClick={openCreateTeamModal}
              >
                <span className="material-symbols-rounded">add</span> Crear Equipo
              </button>
            </div>

            {teams.length === 0 ? (
              <p className="teams-empty">Todavía no has creado ningún equipo. Agrupa usuarios para que puedan colaborar juntos en un tablero compartido.</p>
            ) : (
              <div className="teams-grid">
                {teams.map(t => {
                  const teamTaskCount = activities.filter(a => a.teamId === t.id).length;
                  return (
                    <div key={t.id} className="team-card" onClick={() => handleSelectTeam(t)} title="Clic para ver el tablero de este equipo">
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon-only delete-user-btn team-card-delete"
                        onClick={(e) => handleDeleteTeam(t.id, t.name, e)}
                        title="Eliminar equipo"
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>delete</span>
                      </button>
                      <div className="team-card-icon">
                        <span className="material-symbols-rounded">groups</span>
                      </div>
                      <div className="team-card-name">{t.name}</div>
                      <div className="team-card-meta">{t.memberUsernames.length} miembros · {teamTaskCount} {teamTaskCount === 1 ? 'tarea' : 'tareas'}</div>
                      <div className="team-card-members">
                        {t.memberUsernames.slice(0, 5).map(m => {
                          const u = users.find(user => user.username.toLowerCase() === m.toLowerCase());
                          const nameToUse = u?.fullName || m;
                          return (
                            <span key={m} className="team-member-avatar" title={nameToUse}>{nameToUse.substring(0, 2).toUpperCase()}</span>
                          );
                        })}
                        {t.memberUsernames.length > 5 && (
                          <span className="team-member-avatar team-member-avatar-more">+{t.memberUsernames.length - 5}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Activity Map / Grid Header */}
          <div className="glass-panel activity-map-section">
            <div className="admin-header">
              <div className="activity-map-title">
                <span className="material-symbols-rounded" style={{ fontSize: '24px', color: 'var(--color-secondary)' }}>map</span>
                <h2>Mapa de Actividades del Equipo</h2>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: 'auto', gap: '0.4rem' }}
                onClick={() => window.location.hash = 'stats'}
              >
                <span className="material-symbols-rounded">bar_chart</span> Ver Productividad
              </button>
            </div>

            {/* Detailed row-by-row view of user activities */}
            {users.filter(u => u.username.toLowerCase() !== 'admin' && isUserShown(u.username)).map(u => {
              const userActs = activities.filter(a => a.username.toLowerCase() === u.username.toLowerCase() && !a.teamId);
              const userIsOnline = onlineNow.some(p => p.username.toLowerCase() === u.username.toLowerCase());
              const displayName = u.fullName || u.username;
              return (
                <div
                  className="admin-user-row"
                  key={u.username}
                  onClick={() => handleSelectUser(u)}
                  title="Clic para ver y gestionar el tablero de este usuario"
                  style={{ cursor: 'pointer', transition: 'var(--transition-smooth)' }}
                >
                  <div className="admin-user-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
                      {userIsOnline && <span className="online-now-dot" title="En línea ahora" />}
                      <span className="admin-username" style={{ wordBreak: 'break-all' }}>{displayName}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({u.username})</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon-only delete-user-btn"
                        onClick={(e) => handleDeleteUser(u.username, e)}
                        title="Eliminar usuario"
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>delete</span>
                      </button>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Última sesión: {new Date(u.lastLogin).toLocaleDateString()}
                    </span>
                    <span className="column-count" style={{ width: 'fit-content', marginBottom: '0.5rem' }}>
                      {userActs.length} {userActs.length === 1 ? 'actividad' : 'actividades'}
                    </span>
                  </div>

                  <div
                    className="user-status-columns"
                    style={{ gridTemplateColumns: `repeat(${activeStatusFilters.size === 0 ? 4 : activeStatusFilters.size}, 1fr)` }}
                  >
                    {/* Todo mini list */}
                    {isStatusShown('todo') && (
                    <div className="admin-mini-column">
                      <span className="admin-mini-column-label" style={{ color: 'var(--color-todo)' }}>
                        ● Por Realizar ({userActs.filter(a => a.status === 'todo').length})
                      </span>
                      {userActs.filter(a => a.status === 'todo').map(a => {
                        const prio = a.priority || 'media';
                        return (
                          <div key={a.id} className="admin-mini-card mini-todo">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.15rem', gap: '0.4rem' }}>
                              <div className="admin-mini-card-title">{a.title}</div>
                              <span className={`priority-badge prio-${prio}`} style={{ fontSize: '0.55rem', padding: '0.05rem 0.25rem' }}>
                                {prio.substring(0, 1).toUpperCase()}
                              </span>
                            </div>
                            {a.assignedBy && (
                              <div className="admin-mini-card-by">★ Por: {a.assignedBy}</div>
                            )}
                            <div className="admin-mini-card-dates">{a.startDate} / {a.endDate}</div>
                          </div>
                        );
                      })}
                    </div>
                    )}

                    {/* Doing mini list */}
                    {isStatusShown('doing') && (
                    <div className="admin-mini-column">
                      <span className="admin-mini-column-label" style={{ color: 'var(--color-doing)' }}>
                        ● En Realización ({userActs.filter(a => a.status === 'doing').length})
                      </span>
                      {userActs.filter(a => a.status === 'doing').map(a => {
                        const prio = a.priority || 'media';
                        return (
                          <div key={a.id} className="admin-mini-card mini-doing">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.15rem', gap: '0.4rem' }}>
                              <div className="admin-mini-card-title">{a.title}</div>
                              <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center' }}>
                                <span className="priority-badge" style={{ fontSize: '0.55rem', padding: '0.05rem 0.25rem', color: 'var(--color-doing)' }}>
                                  {a.progress ?? 50}%
                                </span>
                                <span className={`priority-badge prio-${prio}`} style={{ fontSize: '0.55rem', padding: '0.05rem 0.25rem' }}>
                                  {prio.substring(0, 1).toUpperCase()}
                                </span>
                              </div>
                            </div>
                            {a.assignedBy && (
                              <div className="admin-mini-card-by">★ Por: {a.assignedBy}</div>
                            )}
                            <div className="admin-mini-card-dates">{a.startDate} / {a.endDate}</div>
                          </div>
                        );
                      })}
                    </div>
                    )}

                    {/* Done mini list */}
                    {isStatusShown('done') && (
                    <div className="admin-mini-column">
                      <span className="admin-mini-column-label" style={{ color: 'var(--color-done)' }}>
                        ● Realizado ({userActs.filter(a => a.status === 'done').length})
                      </span>
                      {userActs.filter(a => a.status === 'done').map(a => {
                        const prio = a.priority || 'media';
                        return (
                          <div key={a.id} className="admin-mini-card mini-done">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.15rem', gap: '0.4rem' }}>
                              <div className="admin-mini-card-title">{a.title}</div>
                              <span className={`priority-badge prio-${prio}`} style={{ fontSize: '0.55rem', padding: '0.05rem 0.25rem' }}>
                                {prio.substring(0, 1).toUpperCase()}
                              </span>
                            </div>
                            {a.assignedBy && (
                              <div className="admin-mini-card-by">★ Por: {a.assignedBy}</div>
                            )}
                            <div className="admin-mini-card-dates">{a.startDate} / {a.endDate}</div>
                          </div>
                        );
                      })}
                    </div>
                    )}

                    {/* Cancelled mini list */}
                    {isStatusShown('cancelled') && (
                    <div className="admin-mini-column">
                      <span className="admin-mini-column-label" style={{ color: '#d93025' }}>
                        ● Cancelado ({userActs.filter(a => a.status === 'cancelled').length})
                      </span>
                      {userActs.filter(a => a.status === 'cancelled').map(a => {
                        const prio = a.priority || 'media';
                        return (
                          <div key={a.id} className="admin-mini-card mini-cancelled">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.15rem', gap: '0.4rem' }}>
                              <div className="admin-mini-card-title">{a.title}</div>
                              <span className={`priority-badge prio-${prio}`} style={{ fontSize: '0.55rem', padding: '0.05rem 0.25rem' }}>
                                {prio.substring(0, 1).toUpperCase()}
                              </span>
                            </div>
                            {a.assignedBy && (
                              <div className="admin-mini-card-by">★ Por: {a.assignedBy}</div>
                            )}
                            <div className="admin-mini-card-dates">{a.startDate} / {a.endDate}</div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Regular Kanban Board Workspace, Admin Supervising Board, or Team Board */
        <div>
          {(viewingUserAsAdmin || viewingTeam) && (
            <div className="glass-panel supervision-banner animate-fade-in">
              <span className="supervision-banner-text" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '18px', color: 'var(--color-primary)' }}>
                  {viewingTeam ? 'groups' : 'visibility'}
                </span>
                {viewingTeam
                  ? <>Viendo el tablero compartido del equipo: <strong>{viewingTeam.name}</strong></>
                  : <>Supervisando e interactuando con el tablero de: <strong>{viewingUserAsAdmin!.username}</strong></>
                }
              </span>
              <button
                className="btn btn-secondary"
                style={{ width: 'auto', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
                onClick={() => { handleSelectUser(null); handleSelectTeam(null); }}
              >
                {isAdmin ? 'Volver al Panel General' : 'Volver a Mi Tablero'}
              </button>
            </div>
          )}

          {viewingTeam && teamViewers.length > 0 && (
            <div className="team-live-viewers animate-fade-in">
              <span className="online-now-dot" />
              <span>Viendo este tablero ahora mismo contigo:</span>
              <div className="online-now-avatars">
                {teamViewers.map(p => (
                  <span key={p.username} className="team-member-avatar" title={p.username}>{p.username.substring(0, 2).toUpperCase()}</span>
                ))}
              </div>
              <span className="team-live-viewers-names">{teamViewers.map(p => p.username).join(', ')}</span>
            </div>
          )}

          <div className="kanban-grid animate-fade-in">
          {/* TO DO Column */}
          <div
            className={`column ${dragOverColumn === 'todo' ? 'drag-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, 'todo')}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(e) => handleDrop(e, 'todo')}
          >
            <div className="column-header">
              <span className="column-title" style={{ color: 'var(--color-todo)' }}>
                ● Por Realizar
              </span>
              <span className="column-count">{getCount('todo')}</span>
            </div>

            <div className="cards-container">
              {displayedActivities.filter(a => a.status === 'todo').map(act => (
                <div
                  key={act.id}
                  className="task-card border-todo animate-fade-in"
                  draggable
                  onDragStart={(e) => handleDragStart(e, act.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => openEditModal(act)}
                >
                  <div className="task-header" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <h4 className="task-title">{act.title}</h4>
                      <span className="material-symbols-rounded" style={{ fontSize: '16px', color: 'var(--text-muted)', flexShrink: 0 }}>edit</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <span className={`priority-badge prio-${act.priority || 'media'}`}>
                        {act.priority || 'media'}
                      </span>
                    </div>
                  </div>
                  <div className="task-expand">
                    <p className="task-desc">{act.description || 'Sin descripción.'}</p>
                    {act.assignedBy && (
                      <div className="task-assigned-by">
                        <span>★ Asignada por: {act.assignedBy}</span>
                      </div>
                    )}
                  </div>

                  <div className="task-footer">
                    <div className="task-dates">
                      <span>Inicio: {act.startDate}</span>
                      <span>Fin: {act.endDate}</span>
                    </div>
                    <div className="task-owner">
                      <span className="material-symbols-rounded" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', marginRight: '0.25rem' }}>person</span> {act.username}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* DOING Column */}
          <div
            className={`column ${dragOverColumn === 'doing' ? 'drag-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, 'doing')}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(e) => handleDrop(e, 'doing')}
          >
            <div className="column-header">
              <span className="column-title" style={{ color: 'var(--color-doing)' }}>
                ● En Realización
              </span>
              <span className="column-count">{getCount('doing')}</span>
            </div>

            <div className="cards-container">
              {displayedActivities.filter(a => a.status === 'doing').map(act => (
                <div
                  key={act.id}
                  className="task-card border-doing animate-fade-in"
                  draggable
                  onDragStart={(e) => handleDragStart(e, act.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => openEditModal(act)}
                >
                  <div className="task-header" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <h4 className="task-title">{act.title}</h4>
                      <span className="material-symbols-rounded" style={{ fontSize: '16px', color: 'var(--text-muted)', flexShrink: 0 }}>edit</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <span className={`priority-badge prio-${act.priority || 'media'}`}>
                        {act.priority || 'media'}
                      </span>
                      <span className="priority-badge" style={{ background: 'var(--color-primary-glow)', color: 'var(--color-doing)', fontWeight: '600' }}>
                        {act.progress ?? 50}% avance
                      </span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden', marginTop: '0.2rem' }}>
                      <div style={{ width: `${act.progress ?? 50}%`, height: '100%', background: 'var(--color-doing)', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                  <div className="task-expand">
                    <p className="task-desc">{act.description || 'Sin descripción.'}</p>
                    {act.assignedBy && (
                      <div className="task-assigned-by">
                        <span>★ Asignada por: {act.assignedBy}</span>
                      </div>
                    )}
                  </div>

                  <div className="task-footer">
                    <div className="task-dates">
                      <span>Inicio: {act.startDate}</span>
                      <span>Fin: {act.endDate}</span>
                    </div>
                    <div className="task-owner">
                      <span className="material-symbols-rounded" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', marginRight: '0.25rem' }}>person</span> {act.username}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* DONE Column */}
          <div
            className={`column ${dragOverColumn === 'done' ? 'drag-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, 'done')}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(e) => handleDrop(e, 'done')}
          >
            <div className="column-header">
              <span className="column-title" style={{ color: 'var(--color-done)' }}>
                ● Realizado
              </span>
              <span className="column-count">{getCount('done')}</span>
            </div>

            <div className="cards-container">
              {displayedActivities.filter(a => a.status === 'done' && isDoneVisibleOnBoard(a)).map(act => (
                <div
                  key={act.id}
                  className="task-card border-done animate-fade-in"
                  draggable
                  onDragStart={(e) => handleDragStart(e, act.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => openEditModal(act)}
                >
                  <div className="task-header" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <h4 className="task-title">{act.title}</h4>
                      <span className="material-symbols-rounded" style={{ fontSize: '16px', color: 'var(--text-muted)', flexShrink: 0 }}>edit</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <span className={`priority-badge prio-${act.priority || 'media'}`}>
                        {act.priority || 'media'}
                      </span>
                    </div>
                  </div>
                  <div className="task-expand">
                    <p className="task-desc">{act.description || 'Sin descripción.'}</p>
                    {act.assignedBy && (
                      <div className="task-assigned-by">
                        <span>★ Asignada por: {act.assignedBy}</span>
                      </div>
                    )}
                  </div>

                  <div className="task-footer">
                    <div className="task-dates">
                      <span>Inicio: {act.startDate}</span>
                      <span>Fin: {act.endDate}</span>
                    </div>
                    <div className="task-owner">
                      <span className="material-symbols-rounded" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', marginRight: '0.25rem' }}>person</span> {act.username}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Trash zone — hidden until a card is held mid-drag for a beat,
            then it appears as a floating bar at the bottom of the screen,
            and grows further once the card is dragged directly over it. */}
        <div
          className={`trash-zone ${isTrashZoneVisible ? 'is-visible' : ''} ${isTrashHovering ? 'is-hovering' : ''} ${trashBurst ? 'is-burst' : ''}`}
          onDragEnter={handleTrashDragEnter}
          onDragOver={handleTrashDragOver}
          onDragLeave={handleTrashDragLeave}
          onDrop={handleTrashDrop}
        >
          <span className="material-symbols-rounded trash-zone-icon">
            {trashBurst || isTrashHovering ? 'delete_forever' : 'delete'}
          </span>
          <span className="trash-zone-label">
            {isTrashHovering ? '¡Suelta para cancelar!' : 'Suelta aquí para cancelar'}
          </span>
        </div>
      </div>
      )}

      {/* Modal dialog for creating / editing activities */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="glass-panel modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {modalMode === 'create' ? 'Nueva Actividad' : 'Editar Actividad'}
              </h3>
              <button type="button" className="modal-close" onClick={() => setIsModalOpen(false)} aria-label="Cerrar">
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveActivity}>
              {!viewingUserAsAdmin && (isAdmin || viewingTeam) && (
                <div className="form-group">
                  <label className="form-label">Asignar A</label>
                  <select
                    className="form-input"
                    value={targetAssignee}
                    onChange={(e) => setTargetAssignee(e.target.value)}
                    required
                  >
                    <option value="" disabled>Selecciona un usuario...</option>
                    {(viewingTeam ? viewingTeam.memberUsernames : users.filter(u => u.username.toLowerCase() !== 'admin').map(u => u.username)).map(username => (
                      <option key={username} value={username}>{username}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Título</label>
                <input
                  type="text"
                  className="form-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Título de la actividad..."
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Descripción</label>
                <textarea
                  className="form-input"
                  style={{ minHeight: '100px', resize: 'vertical' }}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detalles sobre esta actividad..."
                />
              </div>

              <div className="date-row">
                <div className="form-group">
                  <label className="form-label">Fecha Inicio</label>
                  <input
                    type="date"
                    className="form-input"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha Fin</label>
                  <input
                    type="date"
                    className="form-input"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Estado</label>
                <select
                  className="form-input"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                >
                  <option value="todo">Por Realizar</option>
                  <option value="doing">En Realización</option>
                  <option value="done">Realizado</option>
                </select>
              </div>

              {status === 'doing' && (
                <div className="form-group animate-fade-in">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="form-label">Porcentaje de Avance</label>
                    <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--color-doing)' }}>
                      {progress}%
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      className="form-input"
                      style={{ padding: '0', cursor: 'pointer', height: '8px' }}
                      value={progress}
                      onChange={(e) => setProgress(Number(e.target.value))}
                    />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="form-input"
                      style={{ width: '70px', padding: '0.4rem', textAlign: 'center' }}
                      value={progress}
                      onChange={(e) => {
                        const val = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                        setProgress(val);
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Prioridad</label>
                <select
                  className="form-input"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                >
                  <option value="alta">Alta 🔴</option>
                  <option value="media">Media 🟡</option>
                  <option value="baja">Baja 🟢</option>
                </select>
              </div>

              <div className="modal-footer">
                {modalMode === 'edit' && selectedActivity && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => handleDeleteActivity(selectedActivity.id)}
                    style={{ marginRight: 'auto', width: 'auto', gap: '0.3rem' }}
                  >
                    <span className="material-symbols-rounded">delete</span> Eliminar
                  </button>
                )}
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)} style={{ width: 'auto' }}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Historial: every completed task, not just the last day on the live board */}
      {isHistoryModalOpen && (
        <div className="modal-overlay" onClick={() => setIsHistoryModalOpen(false)}>
          <div className="glass-panel modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-rounded" style={{ color: 'var(--color-done)' }}>history</span>
                Historial de Completadas
              </h3>
              <button type="button" className="modal-close" onClick={() => setIsHistoryModalOpen(false)} aria-label="Cerrar">
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            {historyActivities.length === 0 ? (
              <p className="users-panel-empty">Todavía no hay tareas completadas en el historial.</p>
            ) : (
              <div className="history-list">
                {historyActivities.map(a => (
                  <div key={a.id} className="history-row">
                    <div className="history-row-main">
                      <span className="history-row-title">{a.title}</span>
                      <span className={`priority-badge prio-${a.priority || 'media'}`}>{a.priority || 'media'}</span>
                    </div>
                    {a.description && <p className="history-row-desc">{a.description}</p>}
                    <div className="history-row-meta">
                      {viewingTeam && <span className="history-row-owner">{a.username} · </span>}
                      Completada el {new Date(a.completedAt || a.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Team create modal */}
      {isTeamModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTeamModalOpen(false)}>
          <div className="glass-panel modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Crear Equipo</h3>
              <button type="button" className="modal-close" onClick={() => setIsTeamModalOpen(false)} aria-label="Cerrar">
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>
            <form onSubmit={handleSaveTeam}>
              <div className="form-group">
                <label className="form-label">Nombre del Equipo</label>
                <input
                  type="text"
                  className="form-input"
                  value={teamNameInput}
                  onChange={(e) => setTeamNameInput(e.target.value)}
                  placeholder="Ej. Frontend, Marketing..."
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Miembros ({teamMemberSelection.size} seleccionados)</label>
                {(() => {
                  const nonAdminUsers = users.filter(u => u.username.toLowerCase() !== 'admin');
                  const query = teamMemberSearch.trim().toLowerCase();
                  const filteredUsers = query ? nonAdminUsers.filter(u => u.username.toLowerCase().includes(query)) : nonAdminUsers;
                  return (
                    <>
                      <div className="users-panel-toolbar" style={{ marginBottom: '0.6rem' }}>
                        <div className="users-panel-search">
                          <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>search</span>
                          <input
                            type="text"
                            placeholder="Buscar usuario..."
                            value={teamMemberSearch}
                            onChange={(e) => setTeamMemberSearch(e.target.value)}
                          />
                        </div>
                        <div className="users-panel-actions">
                          <button
                            type="button"
                            onClick={() => setTeamMemberSelection(prev => new Set([...prev, ...filteredUsers.map(u => u.username)]))}
                          >
                            Seleccionar {query ? 'resultados' : 'todos'}
                          </button>
                          <button type="button" onClick={() => setTeamMemberSelection(new Set())} disabled={teamMemberSelection.size === 0}>
                            Ninguno
                          </button>
                        </div>
                      </div>

                      {filteredUsers.length === 0 ? (
                        <p className="users-panel-empty">Sin resultados para "{teamMemberSearch}".</p>
                      ) : (
                        <div className="user-chip-grid" style={{ maxHeight: '180px' }}>
                          {filteredUsers.map(u => {
                            const isSelected = teamMemberSelection.has(u.username);
                            return (
                              <button
                                key={u.username}
                                type="button"
                                className={`user-chip ${isSelected ? 'is-active' : ''}`}
                                onClick={() => toggleTeamMember(u.username)}
                                aria-pressed={isSelected}
                              >
                                {u.username}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsTeamModalOpen(false)} style={{ width: 'auto' }}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={!teamNameInput.trim() || teamMemberSelection.size === 0}>
                  Crear Equipo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* Admin Create User Modal */}
      {isCreateUserModalOpen && (
        <div className="modal-overlay" onClick={() => setIsCreateUserModalOpen(false)}>
          <div className="glass-panel modal-content animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-rounded" style={{ color: 'var(--color-primary)' }}>person_add</span>
                Agregar Nuevo Usuario
              </h3>
              <button type="button" className="modal-close" onClick={() => setIsCreateUserModalOpen(false)} aria-label="Cerrar">
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveNewUser} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Nombre de Usuario (Username)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ej. carlos99"
                  value={newUsernameInput}
                  onChange={(e) => setNewUsernameInput(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Nombre y Apellido</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ej. Carlos Mendoza"
                  value={newFullNameInput}
                  onChange={(e) => setNewFullNameInput(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Tipo de Usuario</label>
                <select
                  className="form-input"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as 'admin' | 'user')}
                >
                  <option value="user">Usuario Normal</option>
                  <option value="admin">Usuario Administrador</option>
                </select>
              </div>

              {createUserError && (
                <p className="form-error" style={{ margin: '0' }}>{createUserError}</p>
              )}

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsCreateUserModalOpen(false)} style={{ width: 'auto' }}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
                  Crear Usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Confirm Modal */}
      {confirmConfig.isOpen && (
        <div className="modal-overlay" onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}>
          <div className="glass-panel modal-content animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: '#d93025', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-rounded">warning</span> {confirmConfig.title}
              </h3>
              <button type="button" className="modal-close" onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} aria-label="Cerrar">
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>
            <div style={{ marginTop: '1rem', marginBottom: '2rem' }}>
              <p style={{ fontSize: '0.95rem', color: 'var(--text-main)', lineHeight: '1.5' }}>
                {confirmConfig.message}
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} style={{ width: 'auto' }}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmConfig.onConfirm}
                style={{ width: 'auto', background: '#d93025', color: '#ffffff', border: 'none' }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
