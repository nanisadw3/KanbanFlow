# KanbanFlow

A real-time, multi-user Kanban board built with React + TypeScript + Node.js (SQLite & WebSockets). Spanish UI.

## Features

- **Kanban board** with three columns (Por Realizar / En Proceso / Realizado) plus a drag-and-hold-to-trash gesture for cancelling tasks.
- **Real-time sync** across devices powered by **WebSockets (Socket.io)** — any change (create, move, edit, delete) shows up instantly for everyone looking at the same board.
- **Local SQLite Database** — persistence stored locally in `kanban.db` via Node.js Express server.
- **Presence indicators** — see who else is online and which board they're currently viewing.
- **Admin dashboard** — clickable stat cards that double as filters, a searchable/paginated user list, per-user and per-team activity clearing, and a "Ver Productividad" page with completion-rate charts per user.
- **Teams** — group users into teams with a shared Kanban board; task assignment is restricted to that team's members.
- **Auto-archive / Historial** — completed tasks stay on the live board for 1 day, then quietly move to a per-context "Historial" view (still there, just off the busy board).
- **Light/dark theme**, persisted in `localStorage`.

## Tech stack

- [Vite](https://vite.dev/) + React 19 + TypeScript
- **Node.js + Express + SQLite (`sqlite3` / `sqlite`)** — server & local database storage
- **Socket.io** — WebSockets real-time bidirection sync
- Plain CSS with design tokens (custom properties) for theming

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Run it

```bash
npm run dev       # Starts backend (Socket.io/SQLite on port 3001) + Vite dev server (http://localhost:5173)
```

- Server auto-creates and seeds `kanban.db` on first launch.
- `npm run build` checks types and compiles production frontend assets.

### Logging in

There's no real auth — usernames are free-text. Typing `admin` reveals a password field; the admin password is `admin` (see `handleLogin` in `src/App.tsx`). Any other username logs in directly and is created on first login.

## Docker

A multi-stage `Dockerfile` builds the frontend with Vite and runs it from the same Node/Express process that serves the API and WebSockets — one container, one port, no nginx. `kanban.db` lives on a volume so it survives rebuilds/redeploys:

```bash
docker build -t kanbanflow .

docker run -p 3001:3001 -v kanbanflow_data:/app/data kanbanflow
```

Open `http://localhost:3001` — the frontend talks to the API on the same origin automatically. For a split deployment (frontend and API on different hosts), pass the API's URL at build time instead:

```bash
docker build --build-arg VITE_BACKEND_URL=https://api.example.com -t kanbanflow .
```

## Project structure

```
src/
  App.tsx        Everything: auth, admin dashboard, teams, kanban board, drag-and-drop,
                  presence, history modal, Google Calendar sync. ~1800 lines, single component.
  App.css         All styling — design tokens, theme, kanban/board/modal/trash-zone styles.
  db.ts           Socket.io client + types, subscriptions, and CRUD functions that emit to the server.
  StatsPage.tsx   Standalone productivity/stats page (routed via #stats).
  main.tsx        Entry point.
server/
  index.ts        Express + Socket.io + SQLite server: schema, socket handlers, and (in
                  production) serves the built frontend from the same port.
Dockerfile, .dockerignore   Container build/serve.
```

For a deep dive into how the app actually works (data model, routing, drag-and-drop internals, known gotchas), see **[CLAUDE.md](./CLAUDE.md)**.
