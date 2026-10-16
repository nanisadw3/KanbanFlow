# KanbanFlow — notes for Claude

This file is project context for future sessions, not user-facing docs (see `README.md` for that). It captures things that aren't obvious from reading the code cold: architectural decisions, data flow, and bugs that were fixed for non-obvious reasons.

## What this is

A real-time multi-user Kanban board. Spanish UI, informal user (typos in prompts are normal, not something to "fix" in their messages). No backend server — Firestore *is* the backend, read/written directly from the browser with open test rules (`allow read, write: if true`). There is no real authentication; usernames are free text, and Firestore security rules are the only thing standing between this app and the internet. Don't add auth infrastructure unless asked — it's an explicit non-goal so far.

## Architecture at a glance

- **Single-component app.** `src/App.tsx` (~1800 lines) holds essentially all state and logic: login, admin dashboard, teams, the kanban board itself, drag-and-drop, presence, the history modal, Google Calendar sync. It has not been split into smaller components. Don't assume a "components/" directory exists — there isn't one.
- **`src/db.ts`** is the entire data layer: Firestore collection names, TypeScript types (`Activity`, `User`, `Team`, `PresenceEntry`), one-time seed data, `subscribe*` functions (return `Unsubscribe`, wrap `onSnapshot`), and CRUD functions. All reads are live subscriptions — there is no "refresh" concept; if data appears stale, look for a missing/broken subscription, not a missing refetch.
- **`src/firebase.ts`** initializes the Firebase app from `VITE_FIREBASE_*` env vars (`.env.local`, git-ignored). These vars are baked into the client bundle at build time — Vite does static replacement, so runtime env vars on a deployed static host do nothing; the Firebase config must be known at `npm run build` time (see `Dockerfile`'s build args).
- **Routing is hash-based**, not a router library: `#stats`, `#user-<username>`, `#team-<teamId>`, or no hash (own board). Handled by a single `hashchange` listener registered once in `App.tsx` (`useEffect` near the top, ~line 153). It reads from `usersRef`/`teamsRef` (refs mirroring the `users`/`teams` state) rather than the state directly, specifically so the listener doesn't need to be re-registered every time those lists change.

## Data model (Firestore collections)

- `activities` — the tasks. Status is `'todo' | 'doing' | 'done' | 'cancelled'`. `teamId` is set for team tasks, absent/null for personal tasks. `completedAt` is set when status becomes `'done'` and cleared otherwise (see `updateActivityStatus` in `db.ts`) — this timestamp, not `createdAt`, drives the 1-day auto-archive.
- `users` — just `{ username, lastLogin }`, keyed by lowercased username. "admin" is a special username (see Auth below), not a role flag on a user document.
- `teams` — `{ id, name, memberUsernames[], createdAt }`.
- `presence` — one doc per user (keyed by lowercased username), `{ username, context, lastSeen }`, written every 8s while the app is open (see the heartbeat `useEffect`, ~line 624). There is **no server-side expiry** (no Realtime Database, no `onDisconnect()`), so a closed tab leaves a stale presence doc behind forever unless `clearPresence` runs on logout. Readers must always filter by `isPresenceFresh()` (`db.ts`, 20s staleness window) — never trust a presence doc's mere existence.

**Firestore quirk:** the SDK throws on `undefined` field values (but accepts `null`). Every write of an optional field (`assignedBy`, `teamId`, `completedAt`) normalizes `undefined → null` before calling Firestore. If you add a new optional `Activity` field, follow this pattern in `addActivity`/`updateActivity` or writes will throw at runtime.

## Auth

Not session-based auth. Admin accounts (role `admin`, or the built-in `admin`) log in with a password that the server verifies (`auth:login`); regular users log in by username only. **No self-registration:** `user:login` only updates an existing user (`touchLogin` in `server/users.ts`) and replies `unknown_user` otherwise; the login screen shows "Ese usuario no existe". Users are created only through `user:create`, which requires the calling admin's username+password in the payload (`checkAdmin`) — the server never trusts a socket just because it's connected — and never overwrites an existing user (case-insensitive), so it can't be used to change someone's role. `isAdmin` in the client is `user.username.toLowerCase() === 'admin' || user.role === 'admin'`. Still unauthenticated: deleting users/tasks/teams and editing tasks (a known, accepted gap).

## Real-time sync

One `useEffect` near the top of `App.tsx` calls `initDB()` (seeds demo data only if `users` is empty) then subscribes to `activities`/`users`/`teams`/`presence` via `onSnapshot`. Every write from any tab/device flows back through these listeners automatically. When adding a new piece of server state, prefer this pattern (subscribe once, keep local state in sync) over one-off `getDocs` reads — the one exception is bulk-delete operations (`clearUserActivities`, `clearTeamActivities`, `deleteUser`) which use `getDocs` + `writeBatch` since they need a point-in-time list to delete, not a live subscription.

## Views / scoping

`displayedActivities` (computed in the render body, not memoized) is the single source of truth for "which activities does the current view show", and everything else (`historyActivities`, `getCount`, the three kanban columns) filters from it. Its scoping logic:

- Viewing a team (`viewingTeam` set) → all activities with that `teamId`, regardless of who's logged in.
- Otherwise, if admin: either one supervised user's personal activities (`viewingUserAsAdmin` set) or all personal (non-team) activities across everyone.
- Otherwise (regular user, own board): just that user's own non-team activities.

When adding a feature that touches "the board," scope it through `displayedActivities`, not `activities` directly, or it'll leak across users/teams.

**Team-scoped assignment:** the "Asignar A" dropdown in the activity modal restricts options to `viewingTeam.memberUsernames` when on a team board, vs. all non-admin users otherwise (`App.tsx`, ~line 1454). If members get added/removed from a team, existing assigned activities keep their `username` as-is — there's no cascading update.

## The Archivero (archive + 1-day auto-archive)

- The rules live in `src/archive.ts` (tested in `server/archive.test.ts`), shared by the board, the admin dashboard, Productividad and the Archivero modal: `isLive` (an **archived open task** — todo/doing — is shelved and stops counting as open/overdue; archived done/cancelled keep counting as outcomes), `isDoneVisibleOnBoard` (a completed task stays on the board only if `completedAt` is within the last day, or it has no `completedAt` — legacy-data safety net, don't remove), `inArchivero` (anything archived, every cancelled task, and completed tasks older than a day), `matchesTab`/`archiveTabCounts`.
- In `App.tsx`, `scopedActivities` is the context scope (team / supervised user / personal); `displayedActivities = scopedActivities.filter(isLive)` feeds the live views; `archiveActivities` (from `scopedActivities`) feeds the Archivero modal. Any status can be archived (`activity:setArchived` has no status condition); `activity:updateStatus` still resets `archived = 0`.
- Restore in the modal: cancelled → status `todo`; archived → unarchive (keeps its status); aged completed → re-complete onto the board.
- Nothing is deleted automatically; archiving is a display flag plus the `archived` column. If an old task "disappeared", look in the Archivero.

## The drag-and-drop / trash-cancel gesture

This is the most fragile, most-iterated part of the app. Native HTML5 Drag and Drop API (`draggable`, `onDragStart/onDragEnd/onDragOver/onDrop/onDragEnter/onDragLeave`), not a library.

**How it's supposed to work:** holding a drag for 550ms reveals a floating "Suelta aquí para cancelar" button at the bottom of the screen (it does *not* sit on screen permanently — this was a deliberate, explicitly-requested design). Dropping a card there opens a confirm dialog; confirming sets `status: 'cancelled'` and plays a brief "burst" animation on the trash icon.

**Two related bugs were found and fixed here — both are worth understanding before touching this code:**

1. **`dragenter`/`dragleave` flicker on child elements.** The trash zone's icon and label `<span>`s were intercepting `dragenter`/`dragleave` from the parent `.trash-zone` div, causing the hover state (`isTrashHovering`) to flicker on/off as the cursor crossed them — a classic HTML5 DnD quirk (the browser fires enter/leave on whatever element is actually under the cursor, not just the div you attached the listener to). Fixed with `pointer-events: none` on `.trash-zone-icon` and `.trash-zone-label` in `App.css`, so hit-testing always resolves to the parent. **If you add any other child element inside `.trash-zone`, it needs `pointer-events: none` too, or this bug comes back.**

2. **Reveal-timer race condition.** The 550ms reveal timer (`setTimeout(() => setIsTrashZoneVisible(true), 550)`, in `handleDragStart`) could fire *after* a drag had already ended (e.g. the user dropped the card on a normal column in under 550ms), resurrecting the trash button with no further drag events left to hide it again — it would just sit there stuck. Fixed with `isDraggingRef` (a ref, not state — it needs to be readable synchronously inside the timer callback without a stale closure): set `true` in `handleDragStart`, `false` in every drag-ending path (`handleDragEnd`, `handleTrashDrop`, and a window-level `dragend` safety net — see below), and the timer callback checks `isDraggingRef.current` before calling `setIsTrashZoneVisible(true)`. **Any new code path that ends a drag must also set `isDraggingRef.current = false`, or this bug returns for that path specifically.**

There's also a **window-level `dragend` listener** (a plain `useEffect` with `window.addEventListener`, not a React synthetic event) that force-resets all drag/trash state as a safety net. Rationale: `dragend` always fires natively when a drag operation ends, even if the specific card's own React `onDragEnd` handler doesn't run for some reason (e.g. a live Firestore update re-renders/unmounts the dragged card mid-drag, detaching it from the tree before React's event delegation can catch the bubbled event). This is real-time collaborative app, so a card genuinely can be removed by someone else's write while you're mid-drag on it.

**Testing note:** the `computer`/browser-automation tool's `left_click_drag` action does **not** trigger native HTML5 DnD events — it only does mousedown/move/up. To test drag-and-drop behavior in a browser, dispatch real `DragEvent` objects via `javascript_tool` instead (`new DragEvent(type, {bubbles:true, cancelable:true, dataTransfer})`), and remember that `setTimeout`/timers can be throttled in background/inactive tabs, so timing-sensitive tests (like the 550ms reveal) need generous waits and should check state after an `await tick(ms)`, not synchronously in the same script tick (React state updates aren't reflected in the DOM until a render commits, which needs an event-loop turn to happen).

## Card compactness (hover-to-expand)

Task cards show only title + dates by default; description and "assigned by" info live inside a `.task-expand` wrapper with `max-height: 0; opacity: 0` that expands on `.task-card:hover`. This is a pure-CSS pattern — no JS state for hover. If a card needs to show its expanded state without hovering (e.g. for a screenshot/test), you can't rely on the `computer` tool's synthetic `hover` action — it does not reliably trigger real CSS `:hover` (confirmed via `element.matches(':hover')` returning `false` after a synthetic hover). Verify visually or via direct DOM/class inspection instead.

## Theming

CSS custom properties (design tokens) drive both themes; dark is default. No hardcoded colors — if you see a raw hex/rgb value being added to `App.css`, that's very likely a bug waiting to happen on theme switch (this happened before: `.task-title { color: #fff }` was invisible on the light theme's white cards, and dark-only `rgba(255,255,255,...)` overlays were used regardless of theme before an `--overlay-rgb` token was introduced to flip per-theme). Light mode is a "soft gray" palette (page `#d6d9de`, cards ~`#e1e4e9`, no white surfaces) chosen to be easy on the eyes — that was an explicit user preference, not a default Vite/React look. Every light text/status color was checked for WCAG AA (>= 4.5:1) against both the page and the card tint; if you change a light token, re-check contrast (the status/danger hues were darkened for this). Productividad (`src/StatsPage.tsx`, charts in `src/StatsCharts.tsx`, count-up hook in `src/useCountUp.ts`, all the math in `src/stats.ts`, tests in `server/stats.test.ts`) keeps red exclusively for overdue; cancelled is gray there. Semantics worth knowing before touching it: the **period** filter never hides open (todo/doing) tasks — done tasks are filtered by `completedAt` (or `createdAt` if missing) and cancelled ones by `createdAt` (there is no cancellation date); the **scope** (personal/teams/all) and period are remembered in localStorage (`statsScope`, `statsPeriod`); "a tiempo" and "cierre medio" only count done tasks that have `completedAt` (legacy ones don't); the weekly trend ignores the period (always the last 8 Monday-start weeks) and omits cancelled tasks. Clicking the donut/KPIs/legend/aging opens an inline task panel (`DrillKey` + `matchesDrill`); Esc closes it. Entrance animations: the page's `ready` flag flips ONE FRAME AFTER the data first arrives (not on mount — the data arrives right after mount, so keying off mount makes the arcs appear already drawn); everything respects `prefers-reduced-motion`.

## Email notifications and overdue tasks

- `users.email` is required at the app level (login of a new user, admin "Nuevo Usuario", and a blocking dialog for anyone logged in without one) but nullable in SQLite, because existing rows have none. `user:setEmail` is the only way to change it afterwards; an admin can edit anyone's from the user row.
- Emails go out from one SMTP account. Its config is resolved field by field: the `settings` table (`smtp_host/port/user/pass/from`, edited from the admin "Correo de avisos" modal) wins over the `SMTP_*`/`MAIL_FROM` env vars. `mailer` in `server/index.ts` is a mutable `let`, rebuilt on `settings:saveMail`; always read it at call time (the overdue checker takes `() => mailer`). With no server/user/password, `mailer.enabled` is false and everything is a no-op — never assume mail was sent.
- Mail settings sockets: `settings:getMail` (open, returns `hasPassword` only — **the SMTP password must never be emitted to a client**), `settings:saveMail` and `settings:testMail` (both require an admin's username+password, verified like `auth:changePassword`). The SMTP password sits in plain text in `kanban.db`; `kanban.db` backups are secret too.
- New-task email: `notifyNewTask` in `server/index.ts`, fired from `activity:add` only when the creator (`assignedBy`) is an admin and the assignee is someone else with an email. Fire-and-forget; failures are logged, never block task creation.
- Overdue email: `runOverdueCheck` (`server/overdue.ts`) skips archived tasks and runs at startup, **right after every activity add/update/updateStatus/setArchived** (`void checkOverdue()`), **at local midnight** (`scheduleMidnightCheck`, recomputed with `msUntilNextLocalMidnight` each time) and every 5 min as a safety net; `createOverdueChecker` never overlaps passes — a call during a pass asks for one immediate repeat so nothing waits for the next tick. `activities.overdueNotifiedAt` is stamped only after a successful send, so SMTP failures and users without an email are retried. The stamp is cleared when `endDate` changes or a task leaves done/cancelled (SQL `CASE` in `activity:update` / `activity:updateStatus`).
- Auto-complete: `autoCompleteAtFull` (`server/autocomplete.ts`), applied in `activity:update`, moves a todo/doing task to done when its progress *changes* to 100 (an already-100% task dragged back to doing doesn't bounce). `updateActivityStatus` (drag) is not affected. A one-time startup sweep (flag `sweep_100_done` in `settings`) moved pre-existing 100% todo/doing tasks to done.
- Team panel vs filters: `src/filters.ts` holds the admin filter as data (`TaskFilter`: statuses any-of, `overdueOnly` AND, users any-of) with `matchesFilter`/`summarizeMatches`/`describeMatches`. The Equipos panel (`teamsExpanded` in `App.tsx`) is expanded by default and can be minimized any time with the "Minimizar" button; a `useEffect` on `filterActive` sets it to collapsed when a filter becomes active and back to expanded when it clears. Collapsed, it is a strip listing only matching teams under a filter (a team matches when at least one of ITS tasks matches) and all teams otherwise; the "Todos" button expands it again (expanded, it shows every team with matching ones highlighted and the rest dimmed). The stat cards' counts and the per-user map still cover personal (non-team) tasks only. Tests: `server/filters.test.ts`.
- "Overdue" on the client has ONE definition: `src/dates.ts` (`isOverdue`, `daysOverdue`, `overdueLabel`, `countOpenAndOverdue`, `overdueRate`), used by the board, the admin dashboard and `StatsPage`; it is independent of the server's `overdueNotifiedAt` stamp, and `today` is refreshed every minute. Its tests live in `server/dates.test.ts` (src/ is type-checked without Node types, so a `node:test` file can't live there). The server keeps its own copy of the rule in SQL (`server/overdue.ts`) — keep them in sync. Admin dashboard: `overdueOnly` is an extra AND condition next to the OR'ed status filters; the productivity percentage is over OPEN tasks (todo+doing), not all tasks.
- Testing gotcha: a copy of `kanban.db` carries the real SMTP settings (and overdue stamps), so a test server started on a copy **will send real emails**. Delete the `smtp_*` rows from the copy (`delete from settings where key like 'smtp_%'`) and start with no `SMTP_*` env vars before testing.
- Gotcha: `io.on('connection')` registers its socket handlers after awaiting the initial snapshots, so a script client that emits immediately on connect loses the event. Wait ~600 ms first when testing with a raw socket.io client.

## Google Calendar sync

`syncWithGoogleCalendar` (~line 259) is optional and self-contained: if no `googleClientId` is set (stored in `localStorage`, entered via the sync modal), it runs a **simulated** sync (just a timeout + success message) — no real network calls. If a Client ID is provided, it uses Google Identity Services (`window.google.accounts.oauth2`, loaded via a `<script>` tag in `index.html`) to get an OAuth token, then POSTs each of the current view's `displayedActivities` to the Google Calendar API as events. This is entirely client-side; there's no server component and no token storage beyond the browser session.

## Visual Bug Debugging with Playwright

- Whenever the user asks to fix or debug a visual bug, UI layout issue, element alignment, or browser rendering behavior:
  - Always use Playwright (`npx playwright`) or browser automation tools to inspect the page visually, capture screenshots/trace UI state, or run automated verification scripts.
  - Verify visually and empirically using browser rendering before declaring the visual bug fixed.

## Known non-goals / things not to add unprompted

- No real authentication/authorization system — the current username-only login is intentional for now.
- No component splitting of `App.tsx` — it's one big component by accumulated decision, not oversight. If asked to refactor, confirm scope first; this file has been iterated on heavily and a refactor is a good way to reintroduce the drag-and-drop bugs above.
- No client test suite exists. `npm run test:server` (node:test via tsx) covers only the server modules `server/email.ts`, `mailer.ts`, `overdue.ts`, `settings.ts`, `autocomplete.ts` and `users.ts`; the client and `server/index.ts` are verified with `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`, `npx oxlint src/`, and manual/browser-automation testing. `npm test` itself does nothing meaningful. Note no tsconfig covers `server/`; typecheck it with `npx tsc --noEmit --ignoreConfig --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck --allowImportingTsExtensions --esModuleInterop --strict --types node server/index.ts`.

## Docker / deployment

`Dockerfile` is a two-stage build (`node:22-alpine` build → `node:22-alpine` runtime — no nginx). The runtime stage runs `npm run server` (`tsx server/index.ts`), and that same Express process serves the built frontend (`dist/`, copied from the build stage) via `express.static` plus a catch-all `sendFile(index.html)` fallback — see the `distPath`/`existsSync` block near the bottom of `server/index.ts`. One container, one port (`PORT`, default 3001). `kanban.db` is written to `DB_PATH` (default `/app/data/kanban.db` in the image, overridden in dev via env var to the old `../kanban.db` default), which is declared as a `VOLUME` so it survives rebuilds — mount it, or the database resets on every redeploy.

`sqlite3`'s native addon needs a C/C++ toolchain to compile, so both Dockerfile stages `apk add python3 make g++` before `npm ci`; the runtime stage `apk del`s them again afterward to keep the final image slim (the compiled `.node` binary doesn't need the toolchain present at runtime, only during install). `tsx` lives in `dependencies`, not `devDependencies` — the runtime stage installs with `--omit=dev` and still needs it to run the server.

`VITE_BACKEND_URL` is optional at build time. `src/db.ts` defaults to `window.location.origin` in a production build (correct for this single-container setup, where the API and frontend share a port) and to `http://localhost:3001` in dev (`import.meta.env.DEV`, since Vite's dev server and the API run on different ports locally). Pass `--build-arg VITE_BACKEND_URL=...` only for a split deployment where the frontend and API are on different hosts.

Firebase env vars (`VITE_FIREBASE_*`) are no longer needed for the Docker build — `src/firebase.ts` is dead code left over from the pre-migration Firestore setup; nothing imports it. Safe to delete along with the `firebase` npm dependency whenever someone gets to it, just not done yet.

## UI primitives

`src/ui.tsx` holds the presentational primitives (`Icon`, `IconButton`, `Avatar`, `Meta`, `TaskDates`, `FieldLabel`, `Segmented`, `TaskCardBody`, `MiniTaskCard`...). The UI is icon-first: tooltips use `data-tip` (CSS), not `title`, for migrated icons (the board cards' title tooltip included). Board cards keep their `<div draggable>` wrapper in `App.tsx` (the drag handlers live there; `TaskCardBody` only renders the inside). The short date format lives in `src/dates.ts`.
