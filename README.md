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
- **Email notices** — every user has a required email; when an admin creates a task for someone they get an email, and a one-time email when one of their tasks becomes overdue. Overdue tasks are also highlighted in red on the board (see [Email notifications](#email-notifications)).
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

## Email notifications

Notices are sent by the server from a **single SMTP account** (not from each admin's own account):

- **New task** — when an admin creates a task assigned to another user who has an email.
- **Overdue task** — once per task, the day after its end date, if it isn't done or cancelled. The server checks every 5 minutes. Changing the end date or reopening a done/cancelled task re-arms the notice.

Configure it with environment variables (never stored in the database or git):

| Variable | Meaning |
|---|---|
| `SMTP_HOST` | SMTP server, e.g. `smtp.gmail.com` |
| `SMTP_PORT` | Port (default `587`; `465` uses TLS) |
| `SMTP_USER` / `SMTP_PASS` | SMTP login. For Gmail use an **app password**, not your account password |
| `MAIL_FROM` | Sender shown to recipients (default `KanbanFlow <SMTP_USER>`) |
| `TZ` | Time zone that decides when "today" rolls over (set it in Docker) |

```bash
SMTP_HOST=smtp.gmail.com SMTP_USER=avisos@tudominio.com SMTP_PASS=xxxx npm run dev
```

Without `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` the app works normally but sends no emails (a warning is logged at startup). Users who have no email yet are asked for one when they log in.

Server-side logic has unit tests: `npm run test:server`.

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
  email.ts        Email validation.
  mailer.ts       nodemailer transport + the two email templates.
  overdue.ts      Periodic overdue-task check (sends each notice once).
  *.test.ts       node:test unit tests (`npm run test:server`).
Dockerfile, .dockerignore   Container build/serve.
```

For a deep dive into how the app actually works (data model, routing, drag-and-drop internals, known gotchas), see **[CLAUDE.md](./CLAUDE.md)**.
