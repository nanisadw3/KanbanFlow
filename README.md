# KanbanFlow

A real-time, multi-user Kanban board built with React + TypeScript + Firebase Firestore. Spanish UI.

## Features

- **Kanban board** with three columns (Por Realizar / En Proceso / Realizado) plus a drag-and-hold-to-trash gesture for cancelling tasks (replaces a traditional "Cancelado" column).
- **Real-time sync** across devices — any change (create, move, edit, delete) shows up instantly for everyone looking at the same board, powered by Firestore's `onSnapshot` listeners.
- **Presence indicators** — see who else is online and which board they're currently viewing.
- **Admin dashboard** — clickable stat cards that double as filters, a searchable/paginated user list, per-user and per-team activity clearing, and a "Ver Productividad" page with completion-rate charts per user.
- **Teams** — group users into teams with a shared Kanban board; task assignment is restricted to that team's members.
- **Auto-archive / Historial** — completed tasks stay on the live board for 1 day, then quietly move to a per-context "Historial" view (still there, just off the busy board).
- **Light/dark theme**, persisted in `localStorage`.
- **Optional Google Calendar sync** — pushes a user's active tasks to their Google Calendar as events (requires a Google OAuth Client ID; without one it runs a harmless simulated sync).

## Tech stack

- [Vite](https://vite.dev/) + React 19 + TypeScript
- [Firebase Firestore](https://firebase.google.com/docs/firestore) — the only backend; no custom server
- Plain CSS with design tokens (custom properties) for theming — no CSS framework
- [oxlint](https://oxc.rs/) for linting

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Firebase

This app requires a Firebase project with **Firestore enabled** (in test mode, or with rules that allow read/write — there is no auth layer, so Firestore security rules are the only gate).

Copy the example env file and fill in your project's config (Firebase Console → Project Settings → General → Your apps → SDK setup and configuration):

```bash
cp .env.local.example .env.local
```

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

`.env.local` is git-ignored. These are Vite `VITE_*` vars, so they get **baked into the client bundle at build time** — that's expected for Firebase web apps (the API key isn't a secret; Firestore security rules are what actually protect the data).

### 3. Run it

```bash
npm run dev       # dev server, http://localhost:5173
npm run build      # type-check + production build to dist/
npm run preview    # preview the production build
npm run lint        # oxlint
```

### Logging in

There's no real auth — usernames are free-text. Typing `admin` reveals a password field; the admin password is `admin` (see `handleLogin` in `src/App.tsx`). Any other username logs in directly and is created on first login.

## Docker

A multi-stage `Dockerfile` builds the app with Node and serves the static bundle with nginx. Because Firebase config is baked in at build time, pass it as build args:

```bash
docker build \
  --build-arg VITE_FIREBASE_API_KEY=... \
  --build-arg VITE_FIREBASE_AUTH_DOMAIN=... \
  --build-arg VITE_FIREBASE_PROJECT_ID=... \
  --build-arg VITE_FIREBASE_STORAGE_BUCKET=... \
  --build-arg VITE_FIREBASE_MESSAGING_SENDER_ID=... \
  --build-arg VITE_FIREBASE_APP_ID=... \
  -t kanbanflow .

docker run -p 8080:80 kanbanflow
```

## Project structure

```
src/
  App.tsx        Everything: auth, admin dashboard, teams, kanban board, drag-and-drop,
                  presence, history modal, Google Calendar sync. ~1800 lines, single component.
  App.css         All styling — design tokens, theme, kanban/board/modal/trash-zone styles.
  db.ts           Firestore data layer: types, seed data, subscriptions, CRUD functions.
  firebase.ts     Firebase app/Firestore initialization from VITE_FIREBASE_* env vars.
  StatsPage.tsx   Standalone productivity/stats page (routed via #stats).
  main.tsx        Entry point.
Dockerfile, nginx.conf, .dockerignore   Container build/serve.
```

For a deep dive into how the app actually works (data model, routing, drag-and-drop internals, known gotchas), see **[CLAUDE.md](./CLAUDE.md)**.
