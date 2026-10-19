import { useState, useEffect, useRef } from 'react';
import {
  initDB,
  subscribeActivities,
  subscribeUsers,
  subscribeTeams,
  subscribePresence,
  loginUser,
  loginAdmin,
  changeAdminPassword,
  createUserByAdmin,
  setUserRole,
  setUserEmail,
  getMailSettings,
  saveMailSettings,
  testMailSettings,
  addActivity,
  updateActivityStatus,
  setActivityArchived,
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
import { todayString, isOverdue as isOverdueOn, formatShortDate } from './dates';
import { isLive, isDoneVisibleOnBoard as isDoneOnBoard, inArchivero, matchesTab, archiveTabCounts } from './archive';
import type { ArchiveTab } from './archive';
import { buildLoginSummary, type LoginSummary } from './summary';
import { Icon, IconButton, Avatar, Meta, PriorityFlag, MiniTaskCard, TaskCardBody, FieldLabel, Segmented, Toast } from './ui';
import { useToast } from './useToast';
import { exportAllTasks } from './exportExcel';
import { isFilterActive, summarizeMatches, describeMatches } from './filters';
import StatsPage from './StatsPage';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmailValid = (v: string) => EMAIL_RE.test(v.trim());

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
  const [overdueOnly, setOverdueOnly] = useState(false); // admin: also require "overdue"
  const [teamsExpanded, setTeamsExpanded] = useState(true); // Equipos panel expanded/collapsed state
  const [activeStatusFilters, setActiveStatusFilters] = useState<Set<'todo' | 'doing' | 'done' | 'cancelled'>>(new Set());
  const [activeUserFilters, setActiveUserFilters] = useState<Set<string>>(new Set());
  const [isUsersPanelOpen, setIsUsersPanelOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');

  // Admin Create User Modal State
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [newUsernameInput, setNewUsernameInput] = useState('');
  const [newFullNameInput, setNewFullNameInput] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [passwordFormError, setPasswordFormError] = useState('');
  const [passwordFormSuccess, setPasswordFormSuccess] = useState(false);
  const [createUserError, setCreateUserError] = useState('');
  // Shown right after logging in: tasks assigned since the previous login + overdue ones.
  const [loginSummary, setLoginSummary] = useState<{ name: string; summary: LoginSummary } | null>(null);
  // Role manager modal (only the user "Inaki" gets the button; the server enforces it too).
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState('');
  const [roleChoice, setRoleChoice] = useState<'admin' | 'user'>('user');
  const [roleNewPassword, setRoleNewPassword] = useState('');
  const [roleAdminPass, setRoleAdminPass] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleMsg, setRoleMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isMailModalOpen, setIsMailModalOpen] = useState(false);
  const [mailClientId, setMailClientId] = useState('');
  const [mailClientSecret, setMailClientSecret] = useState('');
  const [mailRefreshToken, setMailRefreshToken] = useState('');
  const [mailFrom, setMailFrom] = useState('');
  const [mailAdminPass, setMailAdminPass] = useState('');
  const [mailHasSecret, setMailHasSecret] = useState(false);
  const [mailHasRefreshToken, setMailHasRefreshToken] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailMsg, setMailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newUserEmail, setNewUserEmail] = useState('');        // modal "Agregar usuario"
  const [newUserAdminPassword, setNewUserAdminPassword] = useState('');
  const [emailEditTarget, setEmailEditTarget] = useState<string | null>(null); // admin edita el correo de otro
  const [emailDialogValue, setEmailDialogValue] = useState('');
  const [emailDialogError, setEmailDialogError] = useState('');

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

  // "Today" as YYYY-MM-DD, refreshed every minute so overdue tasks turn red without a reload.
  const [today, setToday] = useState(todayString);
  const isOverdue = (a: Activity) => isOverdueOn(a, today);

  // History of completed tasks
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { toast, show: showToast } = useToast();
  const [archiveTab, setArchiveTab] = useState<ArchiveTab>('all');

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

  // Admin: every user's NON-archived tasks to an .xlsx (Resumen + Todas + one sheet per person).
  const handleExportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    const result = await exportAllTasks({ activities, users, teams, today });
    setIsExporting(false);
    showToast(result.message, result.ok);
  };

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

  useEffect(() => {
    const t = setInterval(() => setToday(todayString()), 60_000);
    return () => clearInterval(t);
  }, []);

  // The admin dashboard's filter as data (shared with the team panel's matching).
  const taskFilter = { statuses: activeStatusFilters, overdueOnly, users: activeUserFilters };
  const filterActive = isFilterActive(taskFilter);

  // Activating a filter collapses the Equipos panel to a matching-teams strip; clearing resets it.
  useEffect(() => {
    setTeamsExpanded(!filterActive);
  }, [filterActive]);

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
    const typed = val.trim().toLowerCase();
    if (typed === 'admin' || users.some(u => u.username.toLowerCase() === typed && u.role === 'admin')) {
      setShowPassword(true);
    } else {
      setShowPassword(false);
      setPasswordInput('');
    }
  };

  // `previousLogin` is read from the users list BEFORE this login touches it, so "new" means
  // "assigned since the last time they were here".
  const showLoginSummary = (loggedIn: User, previousLogin?: string) => {
    const summary = buildLoginSummary(activities, loggedIn.username, previousLogin, today);
    if (summary.fresh.length === 0 && summary.overdue.length === 0) return;
    setLoginSummary({ name: (loggedIn.fullName || loggedIn.username).trim().split(/\s+/)[0], summary });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanUsername = usernameInput.trim();
    if (!cleanUsername) {
      setErrorMsg('Por favor introduce tu nombre de usuario');
      return;
    }

    const existingUser = users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());

    // Admin accounts (the built-in "admin" or any user with the admin role)
    // must present their password; the server is what checks it.
    if (cleanUsername.toLowerCase() === 'admin' || existingUser?.role === 'admin') {
      if (!passwordInput) {
        setErrorMsg('Escribe la contraseña de administrador');
        return;
      }
      const auth = await loginAdmin(existingUser?.username ?? cleanUsername, passwordInput);
      if (!auth.ok) {
        setErrorMsg(auth.error === 'timeout' ? 'No se pudo conectar con el servidor' : 'Contraseña de administrador incorrecta');
        return;
      }
      const loggedIn = await loginUser(existingUser?.username ?? cleanUsername, existingUser?.fullName, 'admin');
      setUser(loggedIn);
      showLoginSummary(loggedIn, existingUser?.lastLogin);
      setPasswordInput('');
      return;
    }

    // Accounts are created by admins only; there is no self-registration.
    if (!existingUser) {
      setErrorMsg(users.length === 0
        ? 'Conectando con el servidor, intenta de nuevo en un momento'
        : 'Ese usuario no existe. Pide a un administrador que te cree una cuenta.');
      return;
    }

    const loggedIn = await loginUser(existingUser.username, existingUser.fullName, existingUser.role);
    setUser(loggedIn);
    showLoginSummary(loggedIn, existingUser.lastLogin);
  };

  const openRoleModal = () => {
    setRoleTarget('');
    setRoleChoice('user');
    setRoleNewPassword('');
    setRoleAdminPass('');
    setRoleMsg(null);
    setIsRoleModalOpen(true);
  };

  const roleOf = (username: string): 'admin' | 'user' =>
    users.find(u => u.username === username)?.role === 'admin' ? 'admin' : 'user';

  const handleRoleTargetChange = (username: string) => {
    setRoleTarget(username);
    setRoleNewPassword('');
    setRoleMsg(null);
    if (username) setRoleChoice(roleOf(username));
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !roleTarget) return;
    if (roleChoice === 'admin' && roleOf(roleTarget) !== 'admin' && roleNewPassword.length < 4) {
      setRoleMsg({ ok: false, text: 'La contraseña del nuevo administrador debe tener al menos 4 caracteres.' });
      return;
    }
    setRoleBusy(true);
    setRoleMsg(null);
    const res = await setUserRole({
      adminUsername: user.username, adminPassword: roleAdminPass,
      username: roleTarget, role: roleChoice,
      password: roleChoice === 'admin' ? roleNewPassword : undefined,
    });
    setRoleBusy(false);
    if (!res.ok) {
      const messages: Record<string, string> = {
        bad_password: 'Tu contraseña de administrador es incorrecta.',
        forbidden: 'Solo el administrador principal puede cambiar roles.',
        password_required: 'Escribe una contraseña para el nuevo administrador.',
        too_short: 'La contraseña del nuevo administrador debe tener al menos 4 caracteres.',
        protected: 'El rol de la cuenta "admin" no se puede cambiar.',
        self: 'No puedes cambiar tu propio rol.',
        not_found: 'Ese usuario ya no existe.',
        timeout: 'No se pudo conectar con el servidor.',
      };
      setRoleMsg({ ok: false, text: messages[res.error ?? ''] ?? 'No se pudo cambiar el rol.' });
      return;
    }
    const target = users.find(u => u.username === roleTarget);
    showToast(`${target?.fullName || roleTarget} ahora es ${roleChoice === 'admin' ? 'administrador' : 'usuario'}.`, true);
    setIsRoleModalOpen(false);
  };

  const openCreateUserModal = () => {
    setNewUsernameInput('');
    setNewFullNameInput('');
    setNewUserRole('user');
    setNewUserPassword('');
    setNewUserEmail('');
    setNewUserAdminPassword('');
    setCreateUserError('');
    setIsCreateUserModalOpen(true);
  };

  const openMailModal = async () => {
    setMailClientSecret('');
    setMailRefreshToken('');
    setMailAdminPass('');
    setMailMsg(null);
    setIsMailModalOpen(true);
    const res = await getMailSettings();
    if (res.ok && res.settings) {
      setMailClientId(res.settings.clientId);
      setMailFrom(res.settings.from);
      setMailHasSecret(res.settings.hasClientSecret);
      setMailHasRefreshToken(res.settings.hasRefreshToken);
    }
  };

  const mailErrorText = (res: { error?: string; message?: string }) => {
    switch (res.error) {
      case 'bad_password': return 'Tu contraseña de administrador es incorrecta.';
      case 'timeout': return 'No se pudo conectar con el servidor.';
      case 'not_configured': return 'Primero guarda la configuración (Client ID, Client Secret y Refresh token).';
      case 'no_email': return 'Tu usuario no tiene correo registrado para recibir la prueba.';
      case 'send_failed': return `No se pudo enviar: ${res.message ?? 'error desconocido'}`;
      default: return 'No se pudo completar la operación.';
    }
  };

  const handleSaveMail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setMailBusy(true);
    setMailMsg(null);
    const res = await saveMailSettings({
      adminUsername: user.username, adminPassword: mailAdminPass,
      clientId: mailClientId, clientSecret: mailClientSecret, refreshToken: mailRefreshToken, from: mailFrom,
    });
    setMailBusy(false);
    if (!res.ok) {
      setMailMsg({ ok: false, text: mailErrorText(res) });
      return;
    }
    if (res.settings) {
      setMailHasSecret(res.settings.hasClientSecret);
      setMailHasRefreshToken(res.settings.hasRefreshToken);
    }
    setMailClientSecret('');
    setMailRefreshToken('');
    setMailMsg({
      ok: true,
      text: res.enabled
        ? 'Configuración guardada. Los avisos por correo están activos.'
        : 'Configuración guardada, pero los correos siguen deshabilitados: faltan Client ID, Client Secret o Refresh token.',
    });
  };

  const handleTestMail = async () => {
    if (!user) return;
    if (!mailAdminPass) {
      setMailMsg({ ok: false, text: 'Escribe tu contraseña de administrador para enviar la prueba.' });
      return;
    }
    setMailBusy(true);
    setMailMsg(null);
    const res = await testMailSettings(user.username, mailAdminPass);
    setMailBusy(false);
    setMailMsg(res.ok ? { ok: true, text: `Correo de prueba enviado a ${res.to}.` } : { ok: false, text: mailErrorText(res) });
  };

  const openPasswordModal = () => {
    setCurrentPasswordInput('');
    setNewPasswordInput('');
    setConfirmPasswordInput('');
    setPasswordFormError('');
    setPasswordFormSuccess(false);
    setIsPasswordModalOpen(true);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFormError('');
    if (newPasswordInput.length < 4) {
      setPasswordFormError('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }
    if (newPasswordInput !== confirmPasswordInput) {
      setPasswordFormError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    if (!user) return;
    const res = await changeAdminPassword(user.username, currentPasswordInput, newPasswordInput);
    if (!res.ok) {
      setPasswordFormError(
        res.error === 'timeout' ? 'No se pudo conectar con el servidor.'
        : res.error === 'too_short' ? 'La nueva contraseña debe tener al menos 4 caracteres.'
        : 'La contraseña actual es incorrecta.'
      );
      return;
    }
    setPasswordFormSuccess(true);
    setTimeout(() => setIsPasswordModalOpen(false), 1200);
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

    if (!isEmailValid(newUserEmail)) {
      setCreateUserError('Escribe un correo electrónico válido.');
      return;
    }

    if (newUserRole === 'admin' && newUserPassword.length < 4) {
      setCreateUserError('La contraseña del administrador debe tener al menos 4 caracteres.');
      return;
    }

    if (!user) return;
    const res = await createUserByAdmin({
      adminUsername: user.username, adminPassword: newUserAdminPassword,
      username: cleanUsername, fullName: cleanFullName, role: newUserRole, email: newUserEmail.trim(),
      password: newUserRole === 'admin' ? newUserPassword : undefined,
    });
    if (!res.ok) {
      const messages: Record<string, string> = {
        bad_password: 'Tu contraseña de administrador es incorrecta.',
        exists: 'El nombre de usuario ya está registrado.',
        invalid_email: 'Escribe un correo electrónico válido.',
        too_short: 'La contraseña del administrador debe tener al menos 4 caracteres.',
        timeout: 'No se pudo conectar con el servidor.',
      };
      setCreateUserError(messages[res.error ?? ''] ?? 'No se pudo crear el usuario.');
      return;
    }
    setIsCreateUserModalOpen(false);
  };

  const handleLogout = () => {
    if (user) void clearPresence(user.username);
    setUser(null);
    setUsernameInput('');
    setPasswordInput('');
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
  // A role change made elsewhere reaches the live users list; mirror it onto the session so
  // the panel (and what it lets them do) updates without logging in again.
  useEffect(() => {
    if (!user) return;
    const fresh = users.find(u => u.username.toLowerCase() === user.username.toLowerCase());
    if (fresh && (fresh.role ?? undefined) !== (user.role ?? undefined)) {
      setUser(prev => prev && { ...prev, role: fresh.role ?? undefined });
    }
  }, [users, user]);

  const isAdmin = user?.username.toLowerCase() === 'admin' || user?.role === 'admin';

  // Every user must have an email (it's where task notices are sent). Whoever is
  // logged in without one gets a blocking dialog; an admin can also edit others'.
  const currentUserRecord = user ? users.find(u => u.username.toLowerCase() === user.username.toLowerCase()) : undefined;
  const mustSetOwnEmail = !!currentUserRecord && !currentUserRecord.email;
  const emailDialogTarget = emailEditTarget ?? (mustSetOwnEmail ? user!.username : null);

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailDialogTarget) return;
    if (!isEmailValid(emailDialogValue)) {
      setEmailDialogError('Escribe un correo electrónico válido.');
      return;
    }
    const res = await setUserEmail(emailDialogTarget, emailDialogValue.trim());
    if (!res.ok) {
      setEmailDialogError(res.error === 'timeout' ? 'No se pudo conectar con el servidor' : 'No se pudo guardar el correo.');
      return;
    }
    setEmailEditTarget(null);
    setEmailDialogValue('');
    setEmailDialogError('');
  };

  // Reset the field too: otherwise closing an admin's editor for user X leaves X's address
  // pre-filled in the blocking "register your own email" dialog.
  const closeEmailEditor = () => {
    setEmailEditTarget(null);
    setEmailDialogValue('');
    setEmailDialogError('');
  };

  const openEmailEditor = (u: User, e: React.MouseEvent) => {
    e.stopPropagation();
    setEmailDialogValue(u.email || '');
    setEmailDialogError('');
    setEmailEditTarget(u.username);
  };

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

  const scopedActivities = viewingTeam
    ? activities.filter(a => a.teamId === viewingTeam.id)
    : isAdmin
      ? (viewingUserAsAdmin
          ? activities.filter(a => a.username.toLowerCase() === viewingUserAsAdmin.username.toLowerCase() && !a.teamId)
          : activities.filter(a => !a.teamId)
        )
      : activities.filter(a => a.username.toLowerCase() === user?.username.toLowerCase() && !a.teamId);
  // Live views skip archived open tasks (they're shelved in the Archivero); the Archivero itself
  // reads from scopedActivities.
  const displayedActivities = scopedActivities.filter(isLive);

  // Who's online right now (presence entries seen in the last ~20s), and —
  // when viewing a team board — which of them are looking at this same
  // board with you.
  void presenceTick; // re-evaluate staleness on the periodic tick even without new presence writes
  const now = Date.now();
  const onlineNow = presence.filter(p => isPresenceFresh(p, now));
  const isUserOnline = (username: string) => onlineNow.some(p => p.username.toLowerCase() === username.toLowerCase());
  const teamViewers = viewingTeam
    ? onlineNow.filter(p => p.context === `team-${viewingTeam.id}` && p.username.toLowerCase() !== user?.username.toLowerCase())
    : [];

  // A completed task stays on the live board for 1 day, then drops off it (it still exists —
  // see the Archivero). The rule lives in src/archive.ts, shared with the other views.
  const isDoneVisibleOnBoard = (a: Activity) => isDoneOnBoard(a, now);

  // Everything in the Archivero for the current context (personal/team/supervised user),
  // newest first: anything archived, every cancelled task, and completed tasks older than a day.
  const archiveActivities = scopedActivities
    .filter(a => inArchivero(a, now))
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

    if (activeStatusFilters.size > 0 || overdueOnly) {
      const userActs = activities.filter(a => a.username.toLowerCase() === username.toLowerCase() && !a.teamId && isLive(a));
      const hasMatchingActivity = userActs.some(a =>
        (activeStatusFilters.size === 0 || activeStatusFilters.has(a.status)) && (!overdueOnly || isOverdue(a))
      );
      if (!hasMatchingActivity) return false;
    }

    return true;
  };

  if (!user) {
    return (
      <div className="auth-wrapper">
        <div className="glass-panel auth-card animate-fade-in">
          <h1 className="auth-logo">Kanban<span className="auth-logo-accent">Flow</span></h1>
          <p className="auth-subtitle">Gestiona tus tareas</p>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <FieldLabel icon="person">Nombre de Usuario</FieldLabel>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Escribe tu nombre..."
                  value={usernameInput}
                  onChange={handleUsernameChange}
                  style={{ paddingLeft: '2.5rem' }}
                  required
                />
                <span className="material-symbols-rounded" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '20px' }}>person</span>
              </div>
            </div>

            <div className={`auth-expandable-field ${showPassword ? 'is-expanded' : ''}`}>
              <div className="auth-expandable-content">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <FieldLabel icon="lock">Contraseña de Admin</FieldLabel>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Escribe tu contraseña..."
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
              <span className="material-symbols-rounded">login</span> Entrar
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
            <div className="online-now" data-tip={`En línea: ${onlineNow.map(p => p.username).join(', ')}`}>
              <span className="online-now-dot" />
              <div className="online-now-avatars">
                {onlineNow.slice(0, 4).map(p => <Avatar key={p.username} name={p.username} size={24} online />)}
                {onlineNow.length > 4 && <span className="team-member-avatar team-member-avatar-more">+{onlineNow.length - 4}</span>}
              </div>
            </div>
          )}
          <IconButton icon={theme === 'dark' ? 'light_mode' : 'dark_mode'} label="Cambiar tema" onClick={toggleTheme} />
          {(!isAdmin || viewingUserAsAdmin || viewingTeam) && (
            <IconButton icon="folder_open" label="Archivero" onClick={() => setIsArchiveModalOpen(true)} />
          )}
          {(!isAdmin || viewingUserAsAdmin || viewingTeam) && (
            <IconButton icon="delete_sweep" label="Limpiar tablero" variant="danger" onClick={handleClearBoard} />
          )}
          {isAdmin && !viewingTeam && (
            <>
              <IconButton icon="key" label="Cambiar mi contraseña" onClick={openPasswordModal} />
              <IconButton icon="forward_to_inbox" label="Correo de avisos" onClick={() => void openMailModal()} />
              <IconButton icon="person_add" label="Nuevo usuario" onClick={openCreateUserModal} />
              {user.username.toLowerCase() === 'inaki' && (
                <IconButton icon="manage_accounts" label="Cambiar rol de usuario" onClick={openRoleModal} />
              )}
              <IconButton icon="download" label="Exportar a Excel" onClick={() => void handleExportExcel()} disabled={isExporting} />
            </>
          )}
          <button className="btn btn-primary" onClick={() => openCreateModal()} style={{ gap: '0.4rem', whiteSpace: 'nowrap' }}>
            <span className="material-symbols-rounded">add</span> Nueva tarea
          </button>
          <IconButton icon="logout" label="Cerrar sesión" onClick={handleLogout} />
        </div>
      </div>

      {!isAdmin && !viewingTeam && myTeams.length > 0 && (
        <div className="my-teams-row animate-fade-in">
          <span className="my-teams-label" data-tip="Mis equipos" role="img" aria-label="Mis equipos"><Icon name="groups" size={20} /></span>
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
                <span className="material-symbols-rounded" style={{ fontSize: '26px' }}>group</span>
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
              { key: 'todo', icon: 'assignment', label: 'Por hacer', full: 'Por Realizar', varColor: '--color-todo', varRgb: '--color-todo-rgb' },
              { key: 'doing', icon: 'schedule', label: 'En curso', full: 'En Proceso', varColor: '--color-doing', varRgb: '--color-doing-rgb' },
              { key: 'done', icon: 'check_circle', label: 'Hechas', full: 'Completadas', varColor: '--color-done', varRgb: '--color-done-rgb' },
              { key: 'cancelled', icon: 'cancel', label: 'Canceladas', full: 'Canceladas', varColor: '--color-danger', varRgb: '--color-danger-rgb' },
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
                  data-tip={`Filtrar por: ${cfg.full}`}
                  aria-label={`Filtrar por: ${cfg.full}, ${activities.filter(a => a.status === cfg.key && !a.teamId && isLive(a)).length}`}
                >
                  {isActive && (
                    <span className="stat-filter-check">
                      <span className="material-symbols-rounded">check</span>
                    </span>
                  )}
                  <div className={`stat-icon-box stat-icon-${cfg.key}`}>
                    <span className="material-symbols-rounded" style={{ fontSize: '26px' }}>{cfg.icon}</span>
                  </div>
                  <div className="stat-info">
                    <span className="stat-value">{activities.filter(a => a.status === cfg.key && !a.teamId && isLive(a)).length}</span>
                    <span className="stat-label">{cfg.label}</span>
                  </div>
                </button>
              );
            })}

            {(() => {
              const overdueCount = activities.filter(a => !a.teamId && isOverdue(a)).length;
              return (
                <button
                  type="button"
                  className={`glass-panel stat-card stat-card-filter stat-card-overdue ${overdueOnly ? 'is-active' : ''} ${overdueCount > 0 ? 'has-overdue' : ''} ${!overdueOnly && (activeStatusFilters.size > 0 || activeUserFilters.size > 0) ? 'is-dimmed' : ''}`}
                  style={{ ['--filter-color' as string]: 'var(--color-danger)', ['--filter-color-rgb' as string]: 'var(--color-danger-rgb)' }}
                  onClick={() => setOverdueOnly(o => !o)}
                  aria-pressed={overdueOnly}
                  data-tip="Filtrar por: Retrasadas"
                  aria-label={`Filtrar por: Retrasadas, ${overdueCount}`}
                >
                  {overdueOnly && (
                    <span className="stat-filter-check">
                      <span className="material-symbols-rounded">check</span>
                    </span>
                  )}
                  <div className="stat-icon-box stat-icon-overdue">
                    <span className="material-symbols-rounded" style={{ fontSize: '26px' }}>alarm</span>
                  </div>
                  <div className="stat-info">
                    <span className="stat-value">{overdueCount}</span>
                    <span className="stat-label">Retrasadas</span>
                  </div>
                </button>
              );
            })()}
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
                          >
                            <span className="user-chip-name">{displayName}</span>
                          </button>
                          <IconButton icon="close" label={`Eliminar a ${displayName}`} variant="danger" size={22} className="user-chip-delete" onClick={(e) => handleDeleteUser(u.username, e)} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {(activeStatusFilters.size > 0 || activeUserFilters.size > 0 || overdueOnly) && (
            <div className="filter-hint animate-fade-in">
              <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>filter_alt</span>
              Mostrando solo:{' '}
              {[
                ...[...activeStatusFilters].map(s => s === 'todo' ? 'Por Realizar' : s === 'doing' ? 'En Proceso' : s === 'done' ? 'Completadas' : 'Canceladas'),
                ...(overdueOnly ? ['Retrasadas'] : []),
                ...[...activeUserFilters].map(key => {
                  const found = users.find(u => u.username.toLowerCase() === key);
                  return found ? (found.fullName || found.username) : key;
                }),
              ].join(', ')}
              <button type="button" onClick={() => { setActiveStatusFilters(new Set()); setActiveUserFilters(new Set()); setOverdueOnly(false); }}>Limpiar filtro</button>
            </div>
          )}

          {/* Teams management. Can be minimized at any time, and collapses automatically while a filter is active. */}
          {(() => {
            const teamRows = teams.map(t => {
              const summary = summarizeMatches(activities.filter(a => a.teamId === t.id && isLive(a)), taskFilter, today);
              return { team: t, summary, matches: summary.matching > 0 };
            });
            const matchingTeams = teamRows.filter(r => r.matches);
            const collapsedTeams = filterActive ? matchingTeams : teamRows;

            if (!teamsExpanded) {
              return (
                <div className="glass-panel teams-collapsed animate-fade-in">
                  <div className="teams-collapsed-head">
                    <div className="activity-map-title">
                      <span className="material-symbols-rounded" style={{ fontSize: '22px', color: 'var(--color-secondary)' }}>groups</span>
                      <h2>Equipos</h2>
                      <span className="teams-collapsed-count">
                        {teams.length === 0
                          ? 'sin equipos'
                          : filterActive
                            ? `${matchingTeams.length} de ${teams.length} coinciden con el filtro`
                            : `${teams.length} ${teams.length === 1 ? 'equipo' : 'equipos'}`}
                      </span>
                    </div>
                    <button type="button" className="btn btn-secondary" style={{ width: 'auto', gap: '0.3rem', marginLeft: 'auto' }} data-tip="Mostrar todos los equipos" onClick={() => setTeamsExpanded(true)}>
                      <Icon name="expand_more" size={18} /> Todos
                    </button>
                  </div>
                  {teams.length > 0 && (
                    collapsedTeams.length === 0 ? (
                      <p className="teams-collapsed-empty">Ningún equipo coincide con el filtro.</p>
                    ) : (
                      <div className="teams-collapsed-chips">
                        {collapsedTeams.map(({ team, summary }) => (
                          <button
                            key={team.id}
                            type="button"
                            className="team-chip"
                            onClick={() => handleSelectTeam(team)}
                            title="Clic para ver el tablero de este equipo"
                          >
                            <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>groups</span>
                            <strong>{team.name}</strong>
                            <span className="team-chip-match">{describeMatches(summary, taskFilter)}</span>
                          </button>
                        ))}
                      </div>
                    )
                  )}
                </div>
              );
            }

            return (
          <div className="glass-panel activity-map-section">
            <div className="admin-header">
              <div className="activity-map-title">
                <span className="material-symbols-rounded" style={{ fontSize: '24px', color: 'var(--color-secondary)' }}>groups</span>
                <h2>Equipos</h2>
              </div>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginLeft: 'auto' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: 'auto', gap: '0.4rem' }}
                  onClick={openCreateTeamModal}
                >
                  <span className="material-symbols-rounded">add</span> Crear Equipo
                </button>
                <button type="button" className="btn btn-secondary" style={{ width: 'auto', gap: '0.3rem' }} data-tip="Minimizar la lista de equipos" onClick={() => setTeamsExpanded(false)}>
                  <Icon name="expand_less" size={18} /> Minimizar
                </button>
              </div>
            </div>

            {teams.length === 0 ? (
              <p className="teams-empty">Todavía no has creado ningún equipo. Agrupa usuarios para que puedan colaborar juntos en un tablero compartido.</p>
            ) : (
              <div className="teams-grid">
                {teamRows.map(({ team: t, summary, matches }) => {
                  const teamTaskCount = activities.filter(a => a.teamId === t.id && isLive(a)).length;
                  return (
                    <div key={t.id} className={`team-card ${filterActive ? (matches ? 'is-match' : 'is-dimmed') : ''}`} onClick={() => handleSelectTeam(t)}>
                      <IconButton icon="delete" label="Eliminar equipo" variant="danger" size={30} className="team-card-delete" onClick={(e) => handleDeleteTeam(t.id, t.name, e)} />
                      <div className="team-card-icon">
                        <span className="material-symbols-rounded">groups</span>
                      </div>
                      <div className="team-card-name">{t.name}</div>
                      <div className="team-card-meta">{t.memberUsernames.length} miembros · {teamTaskCount} {teamTaskCount === 1 ? 'tarea' : 'tareas'}</div>
                      {filterActive && matches && (
                        <div className="team-chip-match" style={{ marginTop: '0.3rem' }}>{describeMatches(summary, taskFilter)}</div>
                      )}
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
            );
          })()}

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
            {users
              .filter(u => u.username.toLowerCase() !== 'admin' && isUserShown(u.username))
              .map(u => ({ u, overdueTotal: activities.filter(a => a.username.toLowerCase() === u.username.toLowerCase() && !a.teamId && isOverdue(a)).length }))
              .sort((a, b) => b.overdueTotal - a.overdueTotal) // people with late tasks first (stable otherwise)
              .map(({ u, overdueTotal }) => {
              const userActs = activities.filter(a => a.username.toLowerCase() === u.username.toLowerCase() && !a.teamId && isLive(a) && (!overdueOnly || isOverdue(a)));
              const userIsOnline = onlineNow.some(p => p.username.toLowerCase() === u.username.toLowerCase());
              const displayName = u.fullName || u.username;
              return (
                <div
                  className="admin-user-row"
                  key={u.username}
                  onClick={() => handleSelectUser(u)}
                  style={{ cursor: 'pointer', transition: 'var(--transition-smooth)' }}
                >
                  <div className="admin-user-info">
                    <div className="user-card">
                      <Avatar name={displayName} size={44} online={userIsOnline} />
                      <div className="user-card-body">
                        <div className="user-card-top">
                          <div className="user-card-names">
                            <span className="admin-username" data-tip={displayName}>{displayName}</span>
                            <span className="admin-user-handle">@{u.username}</span>
                          </div>
                          <div className="user-card-actions">
                            <IconButton icon="mail" label="Editar correo" variant="tonal" size={32} onClick={(e) => openEmailEditor(u, e)} />
                            <IconButton icon="delete" label="Eliminar usuario" variant="danger" size={32} onClick={(e) => handleDeleteUser(u.username, e)} />
                          </div>
                        </div>
                        <div className="user-card-chips">
                          <Meta icon="schedule" tip={`Última sesión: ${new Date(u.lastLogin).toLocaleString()}`}>
                            {formatShortDate(new Date(u.lastLogin).toLocaleDateString('en-CA'))}
                          </Meta>
                          {u.email ? (
                            <Meta icon="mail" tip={u.email}><span className="chip-ellipsis">{u.email}</span></Meta>
                          ) : (
                            <span className="chip-missing" data-tip="Este usuario no recibirá avisos hasta registrar un correo">
                              <Icon name="warning" size={14} /> Sin correo
                            </span>
                          )}
                          <Meta icon="task_alt" tip={`${userActs.length} ${userActs.length === 1 ? 'actividad' : 'actividades'}`}>
                            {userActs.length}
                          </Meta>
                          {overdueTotal > 0 && (
                            <Meta icon="alarm" tip={`${overdueTotal} ${overdueTotal === 1 ? 'tarea retrasada' : 'tareas retrasadas'}`} tone="danger">
                              {overdueTotal}
                            </Meta>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    className="user-status-columns"
                    style={{ gridTemplateColumns: `repeat(${activeStatusFilters.size === 0 ? 4 : activeStatusFilters.size}, 1fr)` }}
                  >
                    {/* Todo mini list */}
                    {isStatusShown('todo') && (
                    <div className="admin-mini-column">
                      <span className="admin-mini-column-label" style={{ color: 'var(--color-todo)' }}>
                        <Icon name="assignment" size={14} /> Por hacer ({userActs.filter(a => a.status === 'todo').length})
                      </span>
                      {userActs.filter(a => a.status === 'todo').map(a => (
                        <MiniTaskCard key={a.id} act={a} today={today} overdue={isOverdue(a)} status="todo" />
                      ))}
                    </div>
                    )}

                    {/* Doing mini list */}
                    {isStatusShown('doing') && (
                    <div className="admin-mini-column">
                      <span className="admin-mini-column-label" style={{ color: 'var(--color-doing)' }}>
                        <Icon name="schedule" size={14} /> En curso ({userActs.filter(a => a.status === 'doing').length})
                      </span>
                      {userActs.filter(a => a.status === 'doing').map(a => (
                        <MiniTaskCard key={a.id} act={a} today={today} overdue={isOverdue(a)} status="doing" />
                      ))}
                    </div>
                    )}

                    {/* Done mini list */}
                    {isStatusShown('done') && (
                    <div className="admin-mini-column">
                      <span className="admin-mini-column-label" style={{ color: 'var(--color-done)' }}>
                        <Icon name="check_circle" size={14} /> Hecho ({userActs.filter(a => a.status === 'done').length})
                      </span>
                      {userActs.filter(a => a.status === 'done').map(a => (
                        <MiniTaskCard key={a.id} act={a} today={today} overdue={isOverdue(a)} status="done" />
                      ))}
                    </div>
                    )}

                    {/* Cancelled mini list */}
                    {isStatusShown('cancelled') && (
                    <div className="admin-mini-column">
                      <span className="admin-mini-column-label" style={{ color: 'var(--color-danger)' }}>
                        <Icon name="cancel" size={14} /> Cancelado ({userActs.filter(a => a.status === 'cancelled').length})
                      </span>
                      {userActs.filter(a => a.status === 'cancelled').map(a => (
                        <MiniTaskCard key={a.id} act={a} today={today} overdue={isOverdue(a)} status="cancelled" />
                      ))}
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
                <Icon name="assignment" size={20} /> Por hacer
              </span>
              <span className="column-count">{getCount('todo')}</span>
            </div>

            <div className="cards-container">
              {displayedActivities.filter(a => a.status === 'todo').map(act => (
                <div
                  key={act.id}
                  className={`task-card border-todo animate-fade-in ${isOverdue(act) ? 'overdue' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, act.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => openEditModal(act)}
                >
                  <TaskCardBody act={act} today={today} overdue={isOverdue(act)} ownerOnline={isUserOnline(act.username)} onArchive={() => void setActivityArchived(act.id, true)} />
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
                <Icon name="schedule" size={20} /> En curso
              </span>
              <span className="column-count">{getCount('doing')}</span>
            </div>

            <div className="cards-container">
              {displayedActivities.filter(a => a.status === 'doing').map(act => (
                <div
                  key={act.id}
                  className={`task-card border-doing animate-fade-in ${isOverdue(act) ? 'overdue' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, act.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => openEditModal(act)}
                >
                  <TaskCardBody act={act} today={today} overdue={isOverdue(act)} showProgress ownerOnline={isUserOnline(act.username)} onArchive={() => void setActivityArchived(act.id, true)} />
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
                <Icon name="check_circle" size={20} /> Hecho
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
                  <TaskCardBody act={act} today={today} overdue={false} ownerOnline={isUserOnline(act.username)} onArchive={() => void setActivityArchived(act.id, true)} />
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
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Icon name={modalMode === 'create' ? 'add_task' : 'edit_note'} />
                {modalMode === 'create' ? 'Nueva Actividad' : 'Editar Actividad'}
              </h3>
              <button type="button" className="modal-close" onClick={() => setIsModalOpen(false)} aria-label="Cerrar">
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveActivity}>
              {!viewingUserAsAdmin && (isAdmin || viewingTeam) && (
                <div className="form-group">
                  <FieldLabel icon="person">Asignar A</FieldLabel>
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
                <FieldLabel icon="title">Título</FieldLabel>
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
                <FieldLabel icon="notes">Descripción</FieldLabel>
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
                  <FieldLabel icon="event">Fecha Inicio</FieldLabel>
                  <input
                    type="date"
                    className="form-input"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <FieldLabel icon="event_available">Fecha Fin</FieldLabel>
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
                <FieldLabel icon="flag_circle">Estado</FieldLabel>
                <Segmented
                  ariaLabel="Estado"
                  value={status as 'todo' | 'doing' | 'done'}
                  onChange={(v) => setStatus(v)}
                  options={[
                    { value: 'todo', label: 'Por hacer', icon: 'assignment', color: '--color-todo' },
                    { value: 'doing', label: 'En curso', icon: 'schedule', color: '--color-doing' },
                    { value: 'done', label: 'Hecho', icon: 'check_circle', color: '--color-done' },
                  ]}
                />
              </div>

              {status === 'doing' && (
                <div className="form-group animate-fade-in">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <FieldLabel icon="donut_small">Porcentaje de Avance</FieldLabel>
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
                <FieldLabel icon="flag">Prioridad</FieldLabel>
                <Segmented
                  ariaLabel="Prioridad"
                  value={priority}
                  onChange={(v) => setPriority(v)}
                  options={[
                    { value: 'alta', label: 'Alta', icon: 'flag', color: '--color-danger' },
                    { value: 'media', label: 'Media', icon: 'flag', color: '--color-todo' },
                    { value: 'baja', label: 'Baja', icon: 'flag', color: '--color-done' },
                  ]}
                />
              </div>

              <div className="modal-footer">
                {modalMode === 'edit' && selectedActivity && (
                  <IconButton
                    icon="delete"
                    label="Eliminar actividad"
                    variant="danger"
                    onClick={() => handleDeleteActivity(selectedActivity.id)}
                    className="push-left"
                  />
                )}
                <button type="submit" className="btn btn-primary" style={{ width: 'auto', gap: '0.3rem' }}>
                  <Icon name="check" /> Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archivero: everything archived (any status), every cancelled task, and completed tasks older than a day */}
      {isArchiveModalOpen && (() => {
        const counts = archiveTabCounts(archiveActivities);
        const rows = archiveActivities.filter(a => matchesTab(a, archiveTab));
        const statusIcon: Record<Activity['status'], string> = { todo: 'assignment', doing: 'schedule', done: 'check_circle', cancelled: 'cancel' };
        const statusColor: Record<Activity['status'], string> = { todo: '--color-todo', doing: '--color-doing', done: '--color-done', cancelled: '--color-danger' };
        const statusName: Record<Activity['status'], string> = { todo: 'Por hacer', doing: 'En curso', done: 'Hecha', cancelled: 'Cancelada' };
        // Cancelled tasks come back as "Por hacer"; archived ones leave the Archivero with the
        // status they had; completed tasks that simply aged off are re-completed onto the board.
        const restore = (a: Activity) => {
          if (a.status === 'cancelled') void updateActivityStatus(a.id, 'todo');
          else if (a.archived) void setActivityArchived(a.id, false);
          else void updateActivityStatus(a.id, 'done');
        };
        return (
          <div className="modal-overlay" onClick={() => setIsArchiveModalOpen(false)}>
            <div className="glass-panel modal-content archivero" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Icon name="folder_open" style={{ color: 'var(--color-primary)' }} />
                  Archivero
                </h3>
                <button type="button" className="modal-close" onClick={() => setIsArchiveModalOpen(false)} aria-label="Cerrar">
                  <span className="material-symbols-rounded">close</span>
                </button>
              </div>

              <Segmented
                ariaLabel="Filtrar el archivero"
                value={archiveTab}
                onChange={setArchiveTab}
                options={[
                  { value: 'all', label: `Todas ${counts.all}`, icon: 'folder_open', color: '--color-primary' },
                  { value: 'done', label: `Hechas ${counts.done}`, icon: 'check_circle', color: '--color-done' },
                  { value: 'cancelled', label: `Canceladas ${counts.cancelled}`, icon: 'cancel', color: '--color-danger' },
                  { value: 'archived', label: `Archivadas ${counts.archived}`, icon: 'inventory_2', color: '--color-secondary' },
                ]}
              />

              {rows.length === 0 ? (
                <p className="users-panel-empty">No hay tareas en esta sección del archivero.</p>
              ) : (
                <div className="history-list">
                  {rows.map(a => (
                    <div key={a.id} className="history-row">
                      <div className="history-row-main">
                        <span className="archive-row-title">
                          <Icon name={statusIcon[a.status]} size={18} style={{ color: `var(${statusColor[a.status]})` }} />
                          <span className="history-row-title">{a.title}</span>
                        </span>
                        <span style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                          {a.archived && <Meta icon="inventory_2" tip="Archivada">Archivada</Meta>}
                          <PriorityFlag priority={a.priority} />
                        </span>
                      </div>
                      {a.description && <p className="history-row-desc">{a.description}</p>}
                      <div className="history-row-meta">
                        <span className="archive-row-info">
                          {(viewingTeam || (isAdmin && !viewingUserAsAdmin)) && <span className="history-row-owner">{a.username} · </span>}
                          {a.status === 'done'
                            ? `Completada el ${formatShortDate((a.completedAt || a.createdAt).substring(0, 10))}`
                            : `${statusName[a.status]} · fin ${formatShortDate(a.endDate)}`}
                        </span>
                        <span className="history-row-actions">
                          <IconButton icon="unarchive" label="Restaurar" variant="tonal" size={32} onClick={() => restore(a)} />
                          <IconButton
                            icon="delete"
                            label="Eliminar definitivamente"
                            variant="danger"
                            size={32}
                            onClick={() => showConfirm(
                              'Eliminar Tarea',
                              `¿Eliminar "${a.title}" para siempre? Esta acción no se puede deshacer.`,
                              () => void deleteActivity(a.id)
                            )}
                          />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Team create modal */}
      {isTeamModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTeamModalOpen(false)}>
          <div className="glass-panel modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Icon name="group_add" /> Crear Equipo
              </h3>
              <button type="button" className="modal-close" onClick={() => setIsTeamModalOpen(false)} aria-label="Cerrar">
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>
            <form onSubmit={handleSaveTeam}>
              <div className="form-group">
                <FieldLabel icon="groups">Nombre del Equipo</FieldLabel>
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
                <FieldLabel icon="group">Miembros ({teamMemberSelection.size} seleccionados)</FieldLabel>
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
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={!teamNameInput.trim() || teamMemberSelection.size === 0}>
                  Crear Equipo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* Email dialog: blocking for a user with no email, dismissible when an admin edits someone's */}
      {emailDialogTarget && (
        <div className="modal-overlay" onClick={() => { if (emailEditTarget) closeEmailEditor(); }}>
          <div className="glass-panel modal-content animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-rounded" style={{ color: 'var(--color-primary)' }}>mail</span>
                {emailEditTarget ? `Correo de ${emailEditTarget}` : 'Registra tu correo electrónico'}
              </h3>
              {emailEditTarget && (
                <button type="button" className="modal-close" onClick={closeEmailEditor} aria-label="Cerrar">
                  <span className="material-symbols-rounded">close</span>
                </button>
              )}
            </div>
            <form onSubmit={handleSaveEmail} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {!emailEditTarget && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                  Necesitamos tu correo para avisarte de tareas nuevas y retrasadas.
                </p>
              )}
              <div className="form-group">
                <FieldLabel icon="mail">Correo electrónico</FieldLabel>
                <input
                  type="email"
                  className="form-input"
                  placeholder="Ej. juan@empresa.com"
                  value={emailDialogValue}
                  onChange={(e) => setEmailDialogValue(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              {emailDialogError && <p className="form-error" style={{ margin: 0 }}>{emailDialogError}</p>}
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>Guardar</button>
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
                <FieldLabel icon="badge">Nombre de Usuario (Username)</FieldLabel>
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
                <FieldLabel icon="person">Nombre y Apellido</FieldLabel>
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
                <FieldLabel icon="mail">Correo electrónico</FieldLabel>
                <input
                  type="email"
                  className="form-input"
                  placeholder="Ej. carlos@empresa.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <FieldLabel icon="shield_person">Tipo de Usuario</FieldLabel>
                <select
                  className="form-input"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as 'admin' | 'user')}
                >
                  <option value="user">Usuario Normal</option>
                  <option value="admin">Usuario Administrador</option>
                </select>
              </div>

              {newUserRole === 'admin' && (
                <div className="form-group">
                  <FieldLabel icon="lock">Contraseña del Administrador</FieldLabel>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Mínimo 4 caracteres"
                    autoComplete="new-password"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <FieldLabel icon="admin_panel_settings">Tu contraseña de administrador</FieldLabel>
                <input
                  type="password"
                  className="form-input"
                  autoComplete="current-password"
                  placeholder="Necesaria para crear usuarios"
                  value={newUserAdminPassword}
                  onChange={(e) => setNewUserAdminPassword(e.target.value)}
                  required
                />
              </div>

              {createUserError && (
                <p className="form-error" style={{ margin: '0' }}>{createUserError}</p>
              )}

              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
                  Crear Usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change password modal (admins change their own password) */}
      {isPasswordModalOpen && (
        <div className="modal-overlay" onClick={() => setIsPasswordModalOpen(false)}>
          <div className="glass-panel modal-content animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-rounded" style={{ color: 'var(--color-primary)' }}>key</span>
                Cambiar mi contraseña
              </h3>
              <button type="button" className="modal-close" onClick={() => setIsPasswordModalOpen(false)} aria-label="Cerrar">
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <form onSubmit={handleChangePassword} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <FieldLabel icon="lock">Contraseña actual</FieldLabel>
                <input
                  type="password"
                  className="form-input"
                  autoComplete="current-password"
                  value={currentPasswordInput}
                  onChange={(e) => setCurrentPasswordInput(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <FieldLabel icon="lock_reset">Nueva contraseña</FieldLabel>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Mínimo 4 caracteres"
                  autoComplete="new-password"
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <FieldLabel icon="lock_reset">Confirmar nueva contraseña</FieldLabel>
                <input
                  type="password"
                  className="form-input"
                  autoComplete="new-password"
                  value={confirmPasswordInput}
                  onChange={(e) => setConfirmPasswordInput(e.target.value)}
                  required
                />
              </div>

              {passwordFormError && <p className="form-error" style={{ margin: '0' }}>{passwordFormError}</p>}
              {passwordFormSuccess && (
                <p style={{ margin: 0, color: 'var(--color-done)', fontSize: '0.85rem', fontWeight: 600 }}>Contraseña actualizada.</p>
              )}

              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={passwordFormSuccess}>
                  Guardar contraseña
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Login summary: new + overdue tasks */}
      {loginSummary && user && (
        <div className="modal-overlay" onClick={() => setLoginSummary(null)}>
          <div className="glass-panel modal-content animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Icon name="waving_hand" style={{ color: 'var(--color-primary)' }} />
                ¡Hola, {loginSummary.name}!
              </h3>
              <button type="button" className="modal-close" onClick={() => setLoginSummary(null)} aria-label="Cerrar">
                <Icon name="close" />
              </button>
            </div>
            <p className="summary-intro">Esto es lo que necesita tu atención hoy.</p>

            {loginSummary.summary.overdue.length > 0 && (
              <section className="summary-section">
                <h4 className="summary-section-title summary-title-danger">
                  <Icon name="alarm" size={18} /> Retrasadas ({loginSummary.summary.overdue.length})
                </h4>
                <div className="summary-list">
                  {loginSummary.summary.overdue.map(a => (
                    <MiniTaskCard key={a.id} act={a} today={today} overdue status={a.status} />
                  ))}
                </div>
              </section>
            )}

            {loginSummary.summary.fresh.length > 0 && (
              <section className="summary-section">
                <h4 className="summary-section-title">
                  <Icon name="new_releases" size={18} /> Nuevas para ti ({loginSummary.summary.fresh.length})
                </h4>
                <div className="summary-list">
                  {loginSummary.summary.fresh.map(a => (
                    <MiniTaskCard key={a.id} act={a} today={today} overdue={false} status={a.status} />
                  ))}
                </div>
              </section>
            )}

            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={() => setLoginSummary(null)} style={{ width: 'auto' }}>
                <Icon name="check" size={18} /> Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Role manager (only Inaki) */}
      {isRoleModalOpen && user && (
        <div className="modal-overlay" onClick={() => setIsRoleModalOpen(false)}>
          <div className="glass-panel modal-content animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Icon name="manage_accounts" style={{ color: 'var(--color-primary)' }} />
                Cambiar rol de usuario
              </h3>
              <button type="button" className="modal-close" onClick={() => setIsRoleModalOpen(false)} aria-label="Cerrar">
                <Icon name="close" />
              </button>
            </div>

            <form onSubmit={handleSaveRole} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <FieldLabel icon="person">Usuario</FieldLabel>
                <select className="form-input" value={roleTarget} onChange={(e) => handleRoleTargetChange(e.target.value)} required>
                  <option value="">Selecciona un usuario…</option>
                  {users
                    .filter(u => u.username.toLowerCase() !== 'admin' && u.username.toLowerCase() !== user.username.toLowerCase())
                    .map(u => (
                      <option key={u.username} value={u.username}>
                        {(u.fullName || u.username)} (@{u.username}) · {u.role === 'admin' ? 'Administrador' : 'Usuario'}
                      </option>
                    ))}
                </select>
              </div>

              <fieldset className="role-radio-group" disabled={!roleTarget}>
                <legend><FieldLabel icon="shield_person">Rol</FieldLabel></legend>
                <label className="role-radio">
                  <input type="radio" name="role" value="user" checked={roleChoice === 'user'} onChange={() => setRoleChoice('user')} />
                  <span>Usuario</span>
                </label>
                <label className="role-radio">
                  <input type="radio" name="role" value="admin" checked={roleChoice === 'admin'} onChange={() => setRoleChoice('admin')} />
                  <span>Administrador</span>
                </label>
              </fieldset>

              {roleTarget && roleChoice === 'admin' && roleOf(roleTarget) !== 'admin' && (
                <div className="form-group">
                  <FieldLabel icon="lock">Contraseña para el nuevo administrador</FieldLabel>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Mínimo 4 caracteres"
                    autoComplete="new-password"
                    value={roleNewPassword}
                    onChange={(e) => setRoleNewPassword(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <FieldLabel icon="admin_panel_settings">Tu contraseña de administrador</FieldLabel>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Necesaria para confirmar el cambio"
                  autoComplete="current-password"
                  value={roleAdminPass}
                  onChange={(e) => setRoleAdminPass(e.target.value)}
                  required
                />
              </div>

              {roleMsg && <p className={roleMsg.ok ? undefined : 'form-error'} style={{ margin: 0, fontSize: '0.85rem' }}>{roleMsg.text}</p>}

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsRoleModalOpen(false)} style={{ width: 'auto' }}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={roleBusy || !roleTarget || roleChoice === roleOf(roleTarget)}
                  style={{ width: 'auto' }}
                >
                  Guardar cambio
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mail settings (admin) */}
      {isMailModalOpen && (
        <div className="modal-overlay" onClick={() => setIsMailModalOpen(false)}>
          <div className="glass-panel modal-content animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-rounded" style={{ color: 'var(--color-primary)' }}>forward_to_inbox</span>
                Correo de avisos
              </h3>
              <button type="button" className="modal-close" onClick={() => setIsMailModalOpen(false)} aria-label="Cerrar">
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveMail} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                Cuenta de Gmail (por la API de Gmail) desde la que salen los avisos de tareas nuevas y retrasadas.
              </p>
              <div className="form-group">
                <FieldLabel icon="badge">Client ID</FieldLabel>
                <input type="text" className="form-input" placeholder="1234-abc.apps.googleusercontent.com" autoComplete="off" value={mailClientId} onChange={(e) => setMailClientId(e.target.value)} />
              </div>
              <div className="form-group">
                <FieldLabel icon="key">Client Secret</FieldLabel>
                <input
                  type="password"
                  className="form-input"
                  autoComplete="new-password"
                  placeholder={mailHasSecret ? 'Guardado — déjalo vacío para conservarlo' : 'Client Secret'}
                  value={mailClientSecret}
                  onChange={(e) => setMailClientSecret(e.target.value)}
                />
              </div>
              <div className="form-group">
                <FieldLabel icon="vpn_key">Refresh token</FieldLabel>
                <input
                  type="password"
                  className="form-input"
                  autoComplete="new-password"
                  placeholder={mailHasRefreshToken ? 'Guardado — déjalo vacío para conservarlo' : '1//0g...'}
                  value={mailRefreshToken}
                  onChange={(e) => setMailRefreshToken(e.target.value)}
                />
              </div>
              <div className="form-group">
                <FieldLabel icon="forward_to_inbox">Remitente (De, opcional)</FieldLabel>
                <input type="text" className="form-input" placeholder="KanbanFlow" value={mailFrom} onChange={(e) => setMailFrom(e.target.value)} />
              </div>
              <div className="form-group">
                <FieldLabel icon="admin_panel_settings">Tu contraseña de administrador</FieldLabel>
                <input
                  type="password"
                  className="form-input"
                  autoComplete="current-password"
                  placeholder="Necesaria para guardar o probar"
                  value={mailAdminPass}
                  onChange={(e) => setMailAdminPass(e.target.value)}
                  required
                />
              </div>

              {mailMsg && (
                <p
                  className={mailMsg.ok ? undefined : 'form-error'}
                  style={{ margin: 0, fontSize: '0.85rem', ...(mailMsg.ok ? { color: 'var(--color-done)', fontWeight: 600 } : {}) }}
                >
                  {mailMsg.text}
                </p>
              )}

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => void handleTestMail()} disabled={mailBusy} style={{ width: 'auto' }}>
                  Enviar correo de prueba
                </button>
                <button type="submit" className="btn btn-primary" disabled={mailBusy} style={{ width: 'auto' }}>
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Toast toast={toast} />

      {/* Custom Confirm Modal */}
      {confirmConfig.isOpen && (
        <div className="modal-overlay" onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}>
          <div className="glass-panel modal-content animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Icon name="help" /> {confirmConfig.title}
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
