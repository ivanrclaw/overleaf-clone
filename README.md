# TexFlow — Collaborative LaTeX Editor

A visually attractive OverLeaf clone with real-time LaTeX linting, compilation, and project management.

## Features

- **Smart LaTeX Editor** — CodeMirror 6 with syntax highlighting, bracket matching, and autocomplete
- **Full Linting** — Chktex integration with real-time error/warning diagnostics
- **Instant Compilation** — One-click PDF compilation via Tectonic
- **Project Management** — Create, edit, and delete LaTeX projects
- **Email Authentication** — Secure registration and login with JWT

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, CodeMirror 6
- **Backend:** Express, TypeScript, SQLite (better-sqlite3)
- **LaTeX:** Tectonic (compilation), Chktex (linting)
- **Deploy:** Fly.io with Docker

## Development

```bash
# Install dependencies
cd client && npm install
cd ../server && npm install

# Start backend (port 3001)
cd server && npm run dev

# Start frontend (port 5173, proxies /api to 3001)
cd client && npm run dev
```

## Production

Built and deployed via Docker to Fly.io. The Docker image installs Tectonic and Chktex, builds the client, compiles the server, and serves everything from a single port.

## License

MIT