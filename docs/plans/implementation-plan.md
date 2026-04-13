# OverLeaf Clone Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a visually attractive OverLeaf clone with landing page, email/password auth, project CRUD, and LaTeX editor with full linting.

**Architecture:** Monorepo with `/client` (React+Vite+TypeScript+Magic UI) and `/server` (Express+TypeScript+SQLite via better-sqlite3). LaTeX compilation via `tectonic` (no TeX Live needed). Linting via `chktex`. CodeMirror 6 as the editor with LaTeX language support and diagnostics integration.

**Tech Stack:**
- Frontend: React 18, Vite, TypeScript, Tailwind CSS, Magic UI (@magic-ui/react), CodeMirror 6 (@codemirror/view, @codemirror/state, @codemirror/lang-latex, @codemirror/lint), react-router-dom
- Backend: Express, TypeScript, better-sqlite3, bcryptjs, jsonwebtoken, cors, multer
- LaTeX: tectonic (binary), chktex (binary)
- Deploy: Fly.io (Dockerfile with both client build + server)

---

## Project Structure

```
overleaf-clone/
├── client/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.css
│   │   ├── components/
│   │   │   ├── ui/          # Magic UI components
│   │   │   ├── Landing.tsx
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Editor.tsx
│   │   │   └── Navbar.tsx
│   │   ├── hooks/
│   │   │   └── useAuth.ts
│   │   ├── lib/
│   │   │   └── api.ts
│   │   └── types/
│   │       └── index.ts
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── postcss.config.js
├── server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── db.ts
│   │   ├── middleware/
│   │   │   └── auth.ts
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   └── projects.ts
│   │   └── types/
│   │       └── index.ts
│   ├── package.json
│   └── tsconfig.json
├── Dockerfile
├── fly.toml
├── .gitignore
└── README.md
```

---

## Task Details

### Task 1: Initialize project structure + GitHub repo

Create the monorepo directory structure, initialize git, create the GitHub repo under ivanrclaw.

```bash
mkdir -p ~/projects/overleaf-clone/{client/src/{components/ui,hooks,lib,types},server/src/{middleware,routes,types}}
cd ~/projects/overleaf-clone
git init
# Create all package.json files, tsconfigs, .gitignore, etc.
```

### Task 2: Backend - Database + Auth API

**server/package.json:** express, better-sqlite3, bcryptjs, jsonwebtoken, cors, dotenv, typescript, ts-node, @types/*
**server/src/db.ts:** SQLite setup with users and projects tables
**server/src/routes/auth.ts:** POST /register, POST /login
**server/src/middleware/auth.ts:** JWT verification middleware
**server/src/index.ts:** Express app entry point

Users table: id, email (unique), password_hash, created_at
Projects table: id, user_id (FK), name, content (TEXT - LaTeX source), created_at, updated_at

### Task 3: Backend - Projects CRUD API

**server/src/routes/projects.ts:**
- GET /projects — list user's projects
- POST /projects — create new project (with default LaTeX template)
- GET /projects/:id — get project content
- PUT /projects/:id — save project content (manual save)
- DELETE /projects/:id — delete project
- POST /projects/:id/compile — compile LaTeX with tectonic, return PDF
- POST /projects/:id/lint — lint LaTeX with chktex, return diagnostics

### Task 4: Backend - LaTeX Compilation + Linting

**Compilation endpoint:** Write project content to temp dir, run tectonic, return PDF as base64
**Linting endpoint:** Write project content to temp dir, run chktex --json, parse output, return CodeMirror-compatible diagnostics

### Task 5: Frontend - Setup + Landing Page

**client/package.json:** react, react-dom, react-router-dom, @magic-ui/react, tailwindcss, postcss, autoprefixer, lucide-react, typescript, vite, @vitejs/plugin-react
**client/src/App.tsx:** Router with routes
**client/src/components/Landing.tsx:** Hero section, features, CTA buttons. Use Magic UI components (ShimmerButton, MagicCard, animated gradient backgrounds)
**client/src/components/Navbar.tsx:** Logo, nav links, login/register buttons

### Task 6: Frontend - Auth Pages (Login + Register)

**client/src/components/Login.tsx:** Email + password form, submit to /api/auth/login, store JWT in localStorage, redirect to dashboard
**client/src/components/Register.tsx:** Email + password + confirm password form, submit to /api/auth/register, redirect to login
**client/src/hooks/useAuth.ts:** Context providing user state, login/logout/register methods
**client/src/lib/api.ts:** Axios/fetch wrapper with JWT header injection

### Task 7: Frontend - Dashboard (Project List)

**client/src/components/Dashboard.tsx:** Grid of project cards, "New Project" button, each card shows name, last edited, open/delete buttons
**New Project dialog:** Input for project name, creates with default LaTeX template

### Task 8: Frontend - LaTeX Editor

**client/src/components/Editor.tsx:** CodeMirror 6 with:
- @codemirror/lang-latex for syntax highlighting
- @codemirror/lint for lint gutter integration
- Custom linterSource that calls /api/projects/:id/lint
- Split pane: editor left, PDF preview right
- Toolbar: project name, Save button, Compile button
- Save calls PUT /api/projects/:id
- Compile calls POST /api/projects/:id/compile, shows PDF in iframe/embed

### Task 9: Dockerfile + Fly.io Deployment

**Dockerfile:** Multi-stage — install tectonic + chktex, build client, copy to server, expose port
**fly.toml:** App config
**deploy:** fly deploy

---

## Default LaTeX Template

```latex
\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage{amsmath}
\usepackage{graphicx}

\title{Untitled Document}
\author{}
\date{}

\begin{document}
\maketitle

\section{Introduction}
Start writing here.

\end{document}
```

## API Design

### Auth
- POST /api/auth/register  { email, password } → { token, user }
- POST /api/auth/login     { email, password } → { token, user }
- GET  /api/auth/me        (Authorization header) → { user }

### Projects
- GET    /api/projects           → { projects: [...] }
- POST   /api/projects           { name } → { project }
- GET    /api/projects/:id       → { project }
- PUT    /api/projects/:id       { content } → { project }
- DELETE /api/projects/:id       → { ok: true }
- POST   /api/projects/:id/compile   → { pdf: "base64..." }
- POST   /api/projects/:id/lint       → { diagnostics: [...] }