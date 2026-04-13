import { Router, Response, Request } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import multer from 'multer';
import db from '../db';
import { authMiddleware, RequestWithUser } from '../middleware/auth';

const execFileAsync = promisify(execFile);

const DEFAULT_LATEX_TEMPLATE = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{Untitled Document}
\\author{}
\\date{}

\\begin{document}
\\maketitle

\\section{Introduction}
Start writing here.

\\end{document}`;

// Helper to get the authenticated user from the request
function getUser(req: Request): { id: number; email: string } {
  return (req as unknown as RequestWithUser).user;
}

// Helper: verify project belongs to user, return project or null
function getProjectForUser(projectId: number | string, userId: number): any {
  return db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId);
}

// Helper: ensure parent folders exist for a given path
function ensureParentFolders(projectId: number, filePath: string): void {
  const parts = filePath.split('/').filter(Boolean);
  // Build up folder paths; e.g. for "/chapters/intro.tex" → ["/chapters"]
  // For "/figures/img.png" → ["/figures"]
  for (let i = 1; i < parts.length; i++) {
    const folderPath = '/' + parts.slice(0, i).join('/');
    // Try to insert; if it already exists the UNIQUE constraint will skip
    try {
      db.prepare(
        'INSERT INTO project_files (project_id, name, path, is_folder, content) VALUES (?, ?, ?, 1, ?)'
      ).run(projectId, parts[i - 1], folderPath, '');
    } catch {
      // Already exists — that's fine
    }
  }
}

// Factory function so we can inject multer upload instance
export function createProjectRouter(upload: multer.Multer): Router {
  const router = Router();

  // All routes protected
  router.use(authMiddleware);

  // ─── Project CRUD ─────────────────────────────────────────────

  // GET /api/projects
  router.get('/', (req, res: Response): void => {
    const user = getUser(req);
    const projects = db
      .prepare('SELECT id, name, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
      .all(user.id);
    res.json({ projects });
  });

  // POST /api/projects
  router.post('/', (req, res: Response): void => {
    const user = getUser(req);
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    const insertProject = db.prepare('INSERT INTO projects (user_id, name, content) VALUES (?, ?, ?)');
    const result = insertProject.run(user.id, name.trim(), DEFAULT_LATEX_TEMPLATE);
    const projectId = Number(result.lastInsertRowid);

    // Create root folder entry and main.tex in project_files
    const insertFile = db.prepare('INSERT INTO project_files (project_id, name, path, is_folder, content) VALUES (?, ?, ?, ?, ?)');

    const transaction = db.transaction(() => {
      insertFile.run(projectId, '/', '/', 1, '');
      insertFile.run(projectId, 'main.tex', '/main.tex', 0, DEFAULT_LATEX_TEMPLATE);
    });
    transaction();

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    res.status(201).json({ project });
  });

  // GET /api/projects/:id
  router.get('/:id', (req, res: Response): void => {
    const user = getUser(req);
    const project = getProjectForUser(req.params.id, user.id);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ project });
  });

  // PUT /api/projects/:id  (save)
  router.put('/:id', (req, res: Response): void => {
    const user = getUser(req);
    const { content, name } = req.body;

    const existing = getProjectForUser(req.params.id, user.id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Build update dynamically based on what was sent
    if (content !== undefined && content !== null) {
      db.prepare('UPDATE projects SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .run(content, req.params.id, user.id);

      // Also update main.tex in project_files for backward compat
      db.prepare('UPDATE project_files SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND path = ?')
        .run(content, req.params.id, '/main.tex');
    }

    if (name !== undefined && name !== null) {
      db.prepare('UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .run(name, req.params.id, user.id);
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json({ project });
  });

  // DELETE /api/projects/:id
  router.delete('/:id', (req, res: Response): void => {
    const user = getUser(req);
    const result = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(req.params.id, user.id);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ ok: true });
  });

  // ─── File Routes ──────────────────────────────────────────────

  // GET /api/projects/:id/files — list all files
  router.get('/:id/files', (req, res: Response): void => {
    const user = getUser(req);
    const project = getProjectForUser(req.params.id, user.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const files = db
      .prepare('SELECT id, name, path, is_folder, created_at, updated_at FROM project_files WHERE project_id = ? ORDER BY path')
      .all(req.params.id);

    res.json({ files });
  });

  // POST /api/projects/:id/files — create file or folder
  router.post('/:id/files', (req, res: Response): void => {
    const user = getUser(req);
    const project = getProjectForUser(req.params.id, user.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { name, path: filePath, is_folder, content } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'File name is required' });
      return;
    }
    if (!filePath || typeof filePath !== 'string' || !filePath.startsWith('/')) {
      res.status(400).json({ error: 'Path must start with /' });
      return;
    }

    // Check for duplicate path
    const existing = db
      .prepare('SELECT id FROM project_files WHERE project_id = ? AND path = ?')
      .get(req.params.id, filePath);
    if (existing) {
      res.status(409).json({ error: 'A file or folder at this path already exists' });
      return;
    }

    const isFolder = is_folder ? 1 : 0;
    const fileContent = isFolder ? '' : (content || '');

    // Auto-create parent folders
    ensureParentFolders(Number(req.params.id), filePath);

    const insert = db.prepare(
      'INSERT INTO project_files (project_id, name, path, is_folder, content) VALUES (?, ?, ?, ?, ?)'
    );
    const result = insert.run(req.params.id, name.trim(), filePath, isFolder, fileContent);

    const file = db.prepare('SELECT id, name, path, is_folder, created_at, updated_at FROM project_files WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ file });
  });

  // GET /api/projects/:id/files/:fileId — get file content
  router.get('/:id/files/:fileId', (req, res: Response): void => {
    const user = getUser(req);
    const project = getProjectForUser(req.params.id, user.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const file = db
      .prepare('SELECT id, name, path, content, is_folder, created_at, updated_at FROM project_files WHERE id = ? AND project_id = ?')
      .get(req.params.fileId, req.params.id) as any;

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.json({ file });
  });

  // PUT /api/projects/:id/files/:fileId — update file (auto-save uses this)
  router.put('/:id/files/:fileId', (req, res: Response): void => {
    const user = getUser(req);
    const project = getProjectForUser(req.params.id, user.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const file = db
      .prepare('SELECT id FROM project_files WHERE id = ? AND project_id = ?')
      .get(req.params.fileId, req.params.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const { content, name } = req.body;

    if (content !== undefined) {
      db.prepare('UPDATE project_files SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(content, req.params.fileId);
    }
    if (name !== undefined) {
      db.prepare('UPDATE project_files SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(name, req.params.fileId);
    }

    // If neither content nor name provided, just update timestamp (e.g. touch)
    if (content === undefined && name === undefined) {
      db.prepare('UPDATE project_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(req.params.fileId);
    }

    const updated = db.prepare('SELECT id, name, path, content, is_folder, created_at, updated_at FROM project_files WHERE id = ?').get(req.params.fileId);
    res.json({ file: updated });
  });

  // DELETE /api/projects/:id/files/:fileId — delete file or folder
  router.delete('/:id/files/:fileId', (req, res: Response): void => {
    const user = getUser(req);
    const project = getProjectForUser(req.params.id, user.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const file = db
      .prepare('SELECT id, path, is_folder FROM project_files WHERE id = ? AND project_id = ?')
      .get(req.params.fileId, req.params.id) as any;
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Delete the file itself
    db.prepare('DELETE FROM project_files WHERE id = ?').run(req.params.fileId);

    // If it's a folder, also delete all files with paths starting with folder path + /
    if (file.is_folder) {
      const folderPath = file.path.endsWith('/') ? file.path : file.path + '/';
      db.prepare('DELETE FROM project_files WHERE project_id = ? AND path LIKE ?')
        .run(req.params.id, folderPath + '%');
    }

    res.json({ ok: true });
  });

  // POST /api/projects/:id/files/upload — upload files (multipart/form-data)
  router.post('/:id/files/upload', upload.array('files', 20), (req, res: Response): void => {
    const user = getUser(req);
    const project = getProjectForUser(req.params.id, user.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const folder: string = (req.body.folder as string) || '/';
    const uploadedFiles: any[] = [];

    const insert = db.prepare(
      'INSERT INTO project_files (project_id, name, path, is_folder, content) VALUES (?, ?, ?, 0, ?)'
    );

    const transaction = db.transaction(() => {
      for (const file of files) {
        const filePath = folder.endsWith('/') ? folder + file.originalname : folder + '/' + file.originalname;

        // Check if file already exists at this path
        const existing = db
          .prepare('SELECT id FROM project_files WHERE project_id = ? AND path = ?')
          .get(req.params.id, filePath);

        if (existing) {
          // Update existing file content
          const content = file.buffer.toString('base64');
          db.prepare('UPDATE project_files SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND path = ?')
            .run(content, req.params.id, filePath);
        } else {
          // Ensure parent folders exist
          ensureParentFolders(Number(req.params.id), filePath);

          // Determine if we should store as base64 (binary files) or as text
          const isBinary = isBinaryFile(file.originalname, file.mimetype);
          const content = isBinary ? file.buffer.toString('base64') : file.buffer.toString('utf-8');

          try {
            const result = insert.run(req.params.id, file.originalname, filePath, content);
            const newFile = db.prepare('SELECT id, name, path, is_folder, created_at, updated_at FROM project_files WHERE id = ?').get(result.lastInsertRowid);
            uploadedFiles.push(newFile);
          } catch (err: any) {
            // If unique constraint violation (race condition), try update instead
            if (err.message && err.message.includes('UNIQUE constraint')) {
              const content = isBinary ? file.buffer.toString('base64') : file.buffer.toString('utf-8');
              db.prepare('UPDATE project_files SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND path = ?')
                .run(content, req.params.id, filePath);
              const existingFile = db.prepare('SELECT id, name, path, is_folder, created_at, updated_at FROM project_files WHERE project_id = ? AND path = ?')
                .get(req.params.id, filePath);
              uploadedFiles.push(existingFile);
            } else {
              throw err;
            }
          }
        }
      }
    });

    transaction();

    res.status(201).json({ files: uploadedFiles });
  });

  // ─── Compile ──────────────────────────────────────────────────

  // POST /api/projects/:id/compile
  router.post('/:id/compile', async (req, res: Response): Promise<void> => {
    const user = getUser(req);
    const project = getProjectForUser(req.params.id, user.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Get all files for the project
    const files = db
      .prepare('SELECT path, content, is_folder FROM project_files WHERE project_id = ?')
      .all(req.params.id) as any[];

    if (files.length === 0) {
      // Fallback: use project.content for backward compat
      files.push({ path: '/main.tex', content: project.content, is_folder: 0 });
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overleaf-compile-'));

    try {
      // Write all non-folder files to temp dir preserving folder structure
      for (const file of files) {
        if (file.is_folder) continue;

        // Strip leading slash for filesystem path
        const relPath = file.path.startsWith('/') ? file.path.substring(1) : file.path;
        const absPath = path.join(tmpDir, relPath);

        // Ensure parent directory exists
        const dir = path.dirname(absPath);
        fs.mkdirSync(dir, { recursive: true });

        // Determine if content is base64 encoded (binary) or text
        if (isBinaryPath(file.path)) {
          // Write binary content from base64
          fs.writeFileSync(absPath, Buffer.from(file.content, 'base64'));
        } else {
          fs.writeFileSync(absPath, file.content);
        }
      }

      // Find main.tex file
      const mainFile = files.find((f: any) => f.path === '/main.tex' && !f.is_folder);
      if (!mainFile) {
        res.status(400).json({ error: 'No main.tex file found in project' });
        return;
      }

      const texFile = path.join(tmpDir, 'main.tex');

      // Try pdflatex first (TeX Live), fall back to tectonic
      let compileCmd: string;
      let compileArgs: string[];
      try {
        await execFileAsync('which', ['pdflatex'], { timeout: 5000 });
        compileCmd = 'pdflatex';
        compileArgs = ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', tmpDir, texFile];
      } catch {
        compileCmd = 'tectonic';
        compileArgs = [texFile];
      }

      const { stderr } = await execFileAsync(compileCmd, compileArgs, {
        cwd: tmpDir,
        timeout: 30000,
      });

      const pdfPath = path.join(tmpDir, 'main.pdf');
      if (!fs.existsSync(pdfPath)) {
        res.status(500).json({ error: 'Compilation failed', log: 'PDF file not generated' });
        return;
      }

      const pdfBuffer = fs.readFileSync(pdfPath);
      const pdfBase64 = pdfBuffer.toString('base64');

      res.json({ pdf: pdfBase64 });
    } catch (err: any) {
      const stderr = err.stderr || err.message || '';
      res.status(500).json({ error: 'Compilation failed', log: stderr });
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // ─── Lint ─────────────────────────────────────────────────────

  // POST /api/projects/:id/lint
  router.post('/:id/lint', async (req, res: Response): Promise<void> => {
    const user = getUser(req);
    const project = getProjectForUser(req.params.id, user.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Accept content from request body (for real-time linting of unsaved changes)
    const overrideContent = req.body.content;
    const overrideFileId = req.body.fileId;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overleaf-lint-'));

    try {
      let contentToLint: string;

      if (overrideContent !== undefined) {
        // Single-file linting with provided content (backward compat)
        contentToLint = overrideContent;
      } else {
        // Multi-file: write all project files and lint main.tex or specified file
        const files = db
          .prepare('SELECT path, content, is_folder FROM project_files WHERE project_id = ?')
          .all(req.params.id) as any[];

        if (files.length === 0) {
          contentToLint = project.content;
        } else {
          // Write all files to temp dir
          for (const file of files) {
            if (file.is_folder) continue;
            const relPath = file.path.startsWith('/') ? file.path.substring(1) : file.path;
            const absPath = path.join(tmpDir, relPath);
            const dir = path.dirname(absPath);
            fs.mkdirSync(dir, { recursive: true });

            if (isBinaryPath(file.path)) {
              fs.writeFileSync(absPath, Buffer.from(file.content, 'base64'));
            } else {
              fs.writeFileSync(absPath, file.content);
            }
          }

          // Determine which file to lint
          let targetFile: any;
          if (overrideFileId) {
            targetFile = files.find((f: any) => f.id == overrideFileId && !f.is_folder);
          } else {
            targetFile = files.find((f: any) => f.path === '/main.tex' && !f.is_folder);
          }

          if (!targetFile) {
            targetFile = files.find((f: any) => !f.is_folder);
          }

          if (!targetFile) {
            res.json({ diagnostics: [] });
            return;
          }

          contentToLint = targetFile.content;
        }
      }

      const texFile = path.join(tmpDir, 'main.tex');
      fs.writeFileSync(texFile, contentToLint);

      // Check if chktex is available
      try {
        await execFileAsync('which', ['chktex'], { timeout: 5000 });
      } catch {
        res.json({ diagnostics: [] });
        return;
      }

      const { stdout } = await execFileAsync('chktex', ['--json', '-q', texFile], {
        cwd: tmpDir,
        timeout: 15000,
      });

      let rawDiagnostics: any[] = [];
      if (stdout && stdout.trim().length > 0) {
        try {
          rawDiagnostics = JSON.parse(stdout);
        } catch {
          rawDiagnostics = [];
        }
      }

      const diagnostics = rawDiagnostics.map((d: any) => ({
        from: { line: (d.Line || 1) - 1, col: (d.Col || 1) - 1 },
        to: { line: (d.Line || 1) - 1, col: (d.Col || 1) - 1 },
        severity: d.Severity === 1 ? 'error' : 'warning',
        message: d.Message || '',
      }));

      res.json({ diagnostics });
    } catch (err: any) {
      res.json({ diagnostics: [] });
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  return router;
}

// ─── Helpers ─────────────────────────────────────────────────────

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

function isBinaryPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function isBinaryFile(filename: string, mimetype: string): boolean {
  if (mimetype && mimetype.startsWith('text/')) return false;
  if (mimetype === 'application/json') return false;
  const ext = path.extname(filename).toLowerCase();
  // If it's not a known text extension, treat as binary
  const textExtensions = new Set([
    '.tex', '.txt', '.md', '.bib', '.sty', '.cls', '.cfg', '.csv',
    '.json', '.xml', '.html', '.css', '.js', '.ts', '.yaml', '.yml',
    '.latex', '.ltx', '.tikz',
  ]);
  if (textExtensions.has(ext)) return false;
  // Default to binary for unknown extensions
  return true;
}