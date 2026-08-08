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

- `activities` — the tasks. Status is `'todo' | 'doing' | 'done' | 'cancelled'`. `teamId` is set for team tasks, absent/null for personal tasks. `completedAt` is set when status becomes `'done'` and cleared otherwise (see `updateActivityStatus` in `db.ts`) — this timestamp, not `createdAt`, drives the 3-day auto-archive.
- `users` — just `{ username, lastLogin }`, keyed by lowercased username. "admin" is a special username (see Auth below), not a role flag on a user document.
- `teams` — `{ id, name, memberUsernames[], createdAt }`.
- `presence` — one doc per user (keyed by lowercased username), `{ username, context, lastSeen }`, written every 8s while the app is open (see the heartbeat `useEffect`, ~line 624). There is **no server-side expiry** (no Realtime Database, no `onDisconnect()`), so a closed tab leaves a stale presence doc behind forever unless `clearPresence` runs on logout. Readers must always filter by `isPresenceFresh()` (`db.ts`, 20s staleness window) — never trust a presence doc's mere existence.

**Firestore quirk:** the SDK throws on `undefined` field values (but accepts `null`). Every write of an optional field (`assignedBy`, `teamId`, `completedAt`) normalizes `undefined → null` before calling Firestore. If you add a new optional `Activity` field, follow this pattern in `addActivity`/`updateActivity` or writes will throw at runtime.

## Auth

Not real auth. `usernameInput.toLowerCase() === 'admin'` reveals a password field; the check is a hardcoded string comparison (`passwordInput !== 'admin'`) in `handleLogin`. Any other username logs in immediately, creating a `users` doc on first login via `loginUser`. `isAdmin` throughout the app is computed as `user?.username.toLowerCase() === 'admin'`, not a stored role.

## Real-time sync

One `useEffect` near the top of `App.tsx` calls `initDB()` (seeds demo data only if `users` is empty) then subscribes to `activities`/`users`/`teams`/`presence` via `onSnapshot`. Every write from any tab/device flows back through these listeners automatically. When adding a new piece of server state, prefer this pattern (subscribe once, keep local state in sync) over one-off `getDocs` reads — the one exception is bulk-delete operations (`clearUserActivities`, `clearTeamActivities`, `deleteUser`) which use `getDocs` + `writeBatch` since they need a point-in-time list to delete, not a live subscription.

## Views / scoping

`displayedActivities` (computed in the render body, not memoized) is the single source of truth for "which activities does the current view show", and everything else (`historyActivities`, `getCount`, the three kanban columns) filters from it. Its scoping logic:

- Viewing a team (`viewingTeam` set) → all activities with that `teamId`, regardless of who's logged in.
- Otherwise, if admin: either one supervised user's personal activities (`viewingUserAsAdmin` set) or all personal (non-team) activities across everyone.
- Otherwise (regular user, own board): just that user's own non-team activities.

When adding a feature that touches "the board," scope it through `displayedActivities`, not `activities` directly, or it'll leak across users/teams.

**Team-scoped assignment:** the "Asignar A" dropdown in the activity modal restricts options to `viewingTeam.memberUsernames` when on a team board, vs. all non-admin users otherwise (`App.tsx`, ~line 1454). If members get added/removed from a team, existing assigned activities keep their `username` as-is — there's no cascading update.

## The 3-day auto-archive / Historial

- `THREE_DAYS_MS` + `isDoneVisibleOnBoard(a)` (~line 663): a completed task stays on the live "Realizado" column only if `completedAt` is within the last 3 days, or if it has no `completedAt` at all (legacy-data safety net — don't remove that fallback, it's not dead code).
- `historyActivities` is every `status === 'done'` activity in the current scope, sorted newest-first — this is the full history, not just the last 3 days. The "Historial" modal renders this list.
- Nothing ever deletes a completed task automatically; "archiving" is purely a display filter based on `completedAt`, not a data migration. If the user asks why an old completed task "disappeared," it's still in Firestore — check the Historial modal, not the database.

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

CSS custom properties (design tokens) drive both themes; dark is default. No hardcoded colors — if you see a raw hex/rgb value being added to `App.css`, that's very likely a bug waiting to happen on theme switch (this happened before: `.task-title { color: #fff }` was invisible on the light theme's white cards, and dark-only `rgba(255,255,255,...)` overlays were used regardless of theme before an `--overlay-rgb` token was introduced to flip per-theme). Light mode is meant to be light-*but-grayish*, not stark white — that was an explicit user preference, not a default Vite/React look.

## Google Calendar sync

`syncWithGoogleCalendar` (~line 259) is optional and self-contained: if no `googleClientId` is set (stored in `localStorage`, entered via the sync modal), it runs a **simulated** sync (just a timeout + success message) — no real network calls. If a Client ID is provided, it uses Google Identity Services (`window.google.accounts.oauth2`, loaded via a `<script>` tag in `index.html`) to get an OAuth token, then POSTs each of the current view's `displayedActivities` to the Google Calendar API as events. This is entirely client-side; there's no server component and no token storage beyond the browser session.

## Known non-goals / things not to add unprompted

- No real authentication/authorization system — the current username-only login is intentional for now.
- No component splitting of `App.tsx` — it's one big component by accumulated decision, not oversight. If asked to refactor, confirm scope first; this file has been iterated on heavily and a refactor is a good way to reintroduce the drag-and-drop bugs above.
- No test suite exists. Verification throughout this project's history has been `tsc --noEmit`, `npm run build`, `npx oxlint src/`, and manual/browser-automation testing — not unit tests. Don't assume `npm test` does anything meaningful.

## Docker / deployment

`Dockerfile` is a two-stage build (`node:22-alpine` build stage → `nginx:1.27-alpine` serve stage). `nginx.conf` has an SPA `try_files` fallback to `index.html` even though the app currently only uses hash routing (which doesn't need server-side fallback) — kept as a safety net in case path-based routes are ever added. Firebase config must be passed as `--build-arg`s at image build time (see README), not as container runtime env vars — Vite has already inlined them into the JS bundle by the time the container runs.
