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

// Helper: verify project belongs to user OR user is a project member
function getProjectForUser(projectId: number | string, userId: number): any {
  return db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId);
}

// Helper: get project if user has any membership (owner or shared member)
function getProjectWithMembership(projectId: number | string, userId: number): { project: any; role: string } | null {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;

  const membership = db.prepare(
    'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
  ).get(projectId, userId) as { role: string } | undefined;

  if (!membership) return null;

  return { project, role: membership.role };
}

// Helper: check if user has write access to project
function canEdit(role: string): boolean {
  return role === 'owner' || role === 'editor';
}

// Helper: ensure parent folders exist for a given path
function ensureParentFolders(projectId: number, filePath: string): void {
  const parts = filePath.split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const folderPath = '/' + parts.slice(0, i).join('/');
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

  // GET /api/projects — list user's own projects
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
    const insertMember = db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)');

    const transaction = db.transaction(() => {
      insertFile.run(projectId, '/', '/', 1, '');
      insertFile.run(projectId, 'main.tex', '/main.tex', 0, DEFAULT_LATEX_TEMPLATE);
      insertMember.run(projectId, user.id, 'owner');
    });
    transaction();

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    res.status(201).json({ project });
  });

  // GET /api/projects/:id — get project (accessible by members)
  router.get('/:id', (req, res: Response): void => {
    const user = getUser(req);
    const access = getProjectWithMembership(req.params.id, user.id);

    if (!access) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ project: access.project, role: access.role });
  });

  // PUT /api/projects/:id  (save) — requires edit access
  router.put('/:id', (req, res: Response): void => {
    const user = getUser(req);
    const access = getProjectWithMembership(req.params.id, user.id);

    if (!access) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (!canEdit(access.role)) {
      res.status(403).json({ error: 'You do not have edit access to this project' });
      return;
    }

    const { content, name } = req.body;

    if (content !== undefined && content !== null) {
      db.prepare('UPDATE projects SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(content, req.params.id);

      db.prepare('UPDATE project_files SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND path = ?')
        .run(content, req.params.id, '/main.tex');
    }

    if (name !== undefined && name !== null) {
      db.prepare('UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(name, req.params.id);
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json({ project });
  });

  // DELETE /api/projects/:id — only owner can delete
  router.delete('/:id', (req, res: Response): void => {
    const user = getUser(req);
    const project = getProjectForUser(req.params.id, user.id);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
    res.json({ ok: true });
  });

  // ─── File Routes ──────────────────────────────────────────────

  // GET /api/projects/:id/files — list all files (accessible by members)
  router.get('/:id/files', (req, res: Response): void => {
    const user = getUser(req);
    const access = getProjectWithMembership(req.params.id, user.id);
    if (!access) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const files = db
      .prepare('SELECT id, name, path, is_folder, created_at, updated_at FROM project_files WHERE project_id = ? ORDER BY path')
      .all(req.params.id);

    res.json({ files, role: access.role });
  });

  // POST /api/projects/:id/files — create file or folder (requires edit)
  router.post('/:id/files', (req, res: Response): void => {
    const user = getUser(req);
    const access = getProjectWithMembership(req.params.id, user.id);
    if (!access) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!canEdit(access.role)) {
      res.status(403).json({ error: 'You do not have edit access' });
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

    let normalizedPath = filePath.endsWith('/') && filePath.length > 1
      ? filePath.slice(0, -1)
      : filePath;

    const existing = db
      .prepare('SELECT id FROM project_files WHERE project_id = ? AND path = ?')
      .get(req.params.id, normalizedPath);
    if (existing) {
      res.status(409).json({ error: 'A file or folder at this path already exists' });
      return;
    }

    const isFolder = is_folder ? 1 : 0;
    const fileContent = isFolder ? '' : (content || '');

    ensureParentFolders(Number(req.params.id), normalizedPath);

    const insert = db.prepare(
      'INSERT INTO project_files (project_id, name, path, is_folder, content) VALUES (?, ?, ?, ?, ?)'
    );
    const result = insert.run(req.params.id, name.trim(), normalizedPath, isFolder, fileContent);

    const file = db.prepare('SELECT id, name, path, is_folder, created_at, updated_at FROM project_files WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ file });
  });

  // GET /api/projects/:id/files/:fileId — get file content (accessible by members)
  router.get('/:id/files/:fileId', (req, res: Response): void => {
    const user = getUser(req);
    const access = getProjectWithMembership(req.params.id, user.id);
    if (!access) {
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

  // PUT /api/projects/:id/files/:fileId — update file (requires edit)
  router.put('/:id/files/:fileId', (req, res: Response): void => {
    const user = getUser(req);
    const access = getProjectWithMembership(req.params.id, user.id);
    if (!access) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!canEdit(access.role)) {
      res.status(403).json({ error: 'You do not have edit access' });
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

    if (content === undefined && name === undefined) {
      db.prepare('UPDATE project_files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(req.params.fileId);
    }

    const updated = db.prepare('SELECT id, name, path, content, is_folder, created_at, updated_at FROM project_files WHERE id = ?').get(req.params.fileId);
    res.json({ file: updated });
  });

  // PATCH /api/projects/:id/files/:fileId/move — move/rename (requires edit)
  router.patch('/:id/files/:fileId/move', (req, res: Response): void => {
    const user = getUser(req);
    const access = getProjectWithMembership(req.params.id, user.id);
    if (!access) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!canEdit(access.role)) {
      res.status(403).json({ error: 'You do not have edit access' });
      return;
    }

    const file = db
      .prepare('SELECT id, name, path, is_folder FROM project_files WHERE id = ? AND project_id = ?')
      .get(req.params.fileId, req.params.id) as any;
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const { newPath } = req.body;
    if (!newPath || typeof newPath !== 'string' || !newPath.startsWith('/')) {
      res.status(400).json({ error: 'newPath must start with /' });
      return;
    }

    let normalizedNewPath = newPath.endsWith('/') && newPath.length > 1
      ? newPath.slice(0, -1)
      : newPath;

    const existing = db
      .prepare('SELECT id FROM project_files WHERE project_id = ? AND path = ? AND id != ?')
      .get(req.params.id, normalizedNewPath, req.params.fileId);
    if (existing) {
      res.status(409).json({ error: 'A file or folder already exists at the destination path' });
      return;
    }

    const oldPath = file.path as string;
    const newName = normalizedNewPath.split('/').pop() || file.name;

    ensureParentFolders(Number(req.params.id), normalizedNewPath);

    if (file.is_folder) {
      const folderPrefix = oldPath + '/';
      const children = db
        .prepare('SELECT id, path FROM project_files WHERE project_id = ? AND path LIKE ?')
        .all(req.params.id, folderPrefix + '%') as any[];

      const transaction = db.transaction(() => {
        db.prepare('UPDATE project_files SET name = ?, path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(newName, normalizedNewPath, file.id);

        for (const child of children) {
          const childNewPath = normalizedNewPath + child.path.substring(oldPath.length);
          const childNewName = childNewPath.split('/').pop()!;
          db.prepare('UPDATE project_files SET name = ?, path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(childNewName, childNewPath, child.id);
        }
      });
      transaction();
    } else {
      db.prepare('UPDATE project_files SET name = ?, path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(newName, normalizedNewPath, file.id);
    }

    const updated = db.prepare('SELECT id, name, path, is_folder, created_at, updated_at FROM project_files WHERE id = ?').get(req.params.fileId);
    res.json({ file: updated });
  });

  // DELETE /api/projects/:id/files/:fileId — delete file (requires edit)
  router.delete('/:id/files/:fileId', (req, res: Response): void => {
    const user = getUser(req);
    const access = getProjectWithMembership(req.params.id, user.id);
    if (!access) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!canEdit(access.role)) {
      res.status(403).json({ error: 'You do not have edit access' });
      return;
    }

    const file = db
      .prepare('SELECT id, path, is_folder FROM project_files WHERE id = ? AND project_id = ?')
      .get(req.params.fileId, req.params.id) as any;
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    db.prepare('DELETE FROM project_files WHERE id = ?').run(req.params.fileId);

    if (file.is_folder) {
      const folderPath = file.path.endsWith('/') ? file.path : file.path + '/';
      db.prepare('DELETE FROM project_files WHERE project_id = ? AND path LIKE ?')
        .run(req.params.id, folderPath + '%');
    }

    res.json({ ok: true });
  });

  // POST /api/projects/:id/files/upload — upload files (requires edit)
  router.post('/:id/files/upload', upload.array('files', 20), (req, res: Response): void => {
    const user = getUser(req);
    const access = getProjectWithMembership(req.params.id, user.id);
    if (!access) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!canEdit(access.role)) {
      res.status(403).json({ error: 'You do not have edit access' });
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

        const existing = db
          .prepare('SELECT id FROM project_files WHERE project_id = ? AND path = ?')
          .get(req.params.id, filePath);

        if (existing) {
          const content = file.buffer.toString('base64');
          db.prepare('UPDATE project_files SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND path = ?')
            .run(content, req.params.id, filePath);
        } else {
          ensureParentFolders(Number(req.params.id), filePath);

          const isBinary = isBinaryFile(file.originalname, file.mimetype);
          const content = isBinary ? file.buffer.toString('base64') : file.buffer.toString('utf-8');

          try {
            const result = insert.run(req.params.id, file.originalname, filePath, content);
            const newFile = db.prepare('SELECT id, name, path, is_folder, created_at, updated_at FROM project_files WHERE id = ?').get(result.lastInsertRowid);
            uploadedFiles.push(newFile);
          } catch (err: any) {
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

  // POST /api/projects/:id/compile (accessible by members)
  router.post('/:id/compile', async (req, res: Response): Promise<void> => {
    const user = getUser(req);
    const access = getProjectWithMembership(req.params.id, user.id);
    if (!access) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const draft = req.body.draft === true || req.query.draft === '1';

    const files = db
      .prepare('SELECT path, content, is_folder FROM project_files WHERE project_id = ?')
      .all(req.params.id) as any[];

    if (files.length === 0) {
      res.status(400).json({ error: 'No files in project' });
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overleaf-compile-'));

    try {
      for (const file of files) {
        if (file.is_folder) continue;

        const relPath = file.path.startsWith('/') ? file.path.substring(1) : file.path;
        const absPath = path.join(tmpDir, relPath);
        const dir = path.dirname(absPath);
        fs.mkdirSync(dir, { recursive: true });

        if (isBinaryPath(file.path)) {
          fs.writeFileSync(absPath, Buffer.from(file.content, 'base64'));
        } else {
          if (draft && (file.path.endsWith('.tex') || file.path === '/main.tex')) {
            let texContent = file.content;
            texContent = texContent.replace(
              /\\documentclass(\[([^\]]*)\])?/g,
              (match: string, _bracket: string | undefined, options: string | undefined) => {
                if (options && options.includes('draft')) return match;
                if (options) return `\\documentclass[${options},draft]`;
                return `\\documentclass[draft]`;
              }
            );
            fs.writeFileSync(absPath, texContent);
          } else {
            fs.writeFileSync(absPath, file.content);
          }
        }
      }

      const mainFile = files.find((f: any) => f.path === '/main.tex' && !f.is_folder);
      if (!mainFile) {
        res.status(400).json({ error: 'No main.tex file found in project' });
        return;
      }

      const texFile = path.join(tmpDir, 'main.tex');

      let compileCmd: string;
      let compileArgs: string[];
      try {
        await execFileAsync('which', ['pdflatex'], { timeout: 5000 });
        compileCmd = 'pdflatex';
        // In draft mode, \documentclass[draft] is already injected in the .tex file above.
        // We do NOT use pdflatex -draftmode because that skips PDF generation entirely.
        compileArgs = ['-interaction=nonstopmode', '-output-directory', tmpDir, texFile];
      } catch {
        compileCmd = 'tectonic';
        compileArgs = [texFile];
      }

      let compileResult: { stdout: string; stderr: string };
      try {
        compileResult = await execFileAsync(compileCmd, compileArgs, {
          cwd: tmpDir,
          timeout: 30000,
        });
      } catch (err: any) {
        // pdflatex exits with code 1 on LaTeX errors, but stderr has the log
        compileResult = { stdout: err.stdout || '', stderr: err.stderr || err.message || '' };
      }

      const pdfPath = path.join(tmpDir, 'main.pdf');
      if (fs.existsSync(pdfPath)) {
        const pdfBuffer = fs.readFileSync(pdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');

        // Parse warnings/errors from log for the frontend
        const fullLog = compileResult.stdout + compileResult.stderr;
        const compileErrors = parseLatexLog(fullLog);

        res.json({ pdf: pdfBase64, compileErrors: compileErrors.length > 0 ? compileErrors : undefined });
      } else {
        // Compilation failed — parse errors from log
        const fullLog = compileResult.stdout + compileResult.stderr;
        const compileErrors = parseLatexLog(fullLog);

        // Also try to read the .log file for more detail
        const logPath = path.join(tmpDir, 'main.log');
        let logContent = fullLog;
        if (fs.existsSync(logPath)) {
          logContent = fs.readFileSync(logPath, 'utf-8');
        }

        const allErrors = compileErrors.length > 0 ? compileErrors : parseLatexLog(logContent);

        res.status(200).json({
          error: allErrors.length > 0
            ? allErrors.map((e: any) => `Line ${e.line}: ${e.message}`).join('\n')
            : 'Compilation failed — no PDF generated',
          log: logContent,
          compileErrors: allErrors,
        });
      }
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

  // POST /api/projects/:id/lint (accessible by members)
  router.post('/:id/lint', async (req, res: Response): Promise<void> => {
    const user = getUser(req);
    const access = getProjectWithMembership(req.params.id, user.id);
    if (!access) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const overrideContent = req.body.content;
    const overrideFileId = req.body.fileId;

    const project = access.project;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overleaf-lint-'));

    try {
      let contentToLint: string;

      if (overrideContent !== undefined) {
        contentToLint = overrideContent;
      } else {
        const files = db
          .prepare('SELECT path, content, is_folder FROM project_files WHERE project_id = ?')
          .all(req.params.id) as any[];

        if (files.length === 0) {
          contentToLint = project.content;
        } else {
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
  const textExtensions = new Set([
    '.tex', '.txt', '.md', '.bib', '.sty', '.cls', '.cfg', '.csv',
    '.json', '.xml', '.html', '.css', '.js', '.ts', '.yaml', '.yml',
    '.latex', '.ltx', '.tikz',
  ]);
  if (textExtensions.has(ext)) return false;
  return true;
}

// Parse pdflatex log output for errors and warnings
function parseLatexLog(log: string): { line: number; message: string; severity: 'error' | 'warning'; file?: string }[] {
  const results: { line: number; message: string; severity: 'error' | 'warning'; file?: string }[] = [];
  if (!log) return results;

  const lines = log.split('\n');
  let currentFile: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track current file: matches lines like "(./main.tex" or "(./chapters/intro.tex"
    const fileMatch = line.match(/\(\.?\/([^\s()]+\.(?:tex|sty|cls|bib))/);
    if (fileMatch) {
      currentFile = fileMatch[1];
    }

    // Match LaTeX errors: "! LaTeX Error: ..." or "! ..."
    const errorMatch = line.match(/^!\s+(.+)$/);
    if (errorMatch) {
      // Look ahead for line number: "l.42" or "l.42 ..."
      let errorLine = 0;
      let errorMsg = errorMatch[1];
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const lineNumMatch = lines[j].match(/^l\.(\d+)/);
        if (lineNumMatch) {
          errorLine = parseInt(lineNumMatch[1], 10);
          // Include the context after l.N
          const contextAfter = lines[j].replace(/^l\.\d+\s*/, '').trim();
          if (contextAfter) errorMsg += ' — ' + contextAfter;
          break;
        }
      }
      results.push({
        line: errorLine,
        message: errorMsg,
        severity: 'error',
        file: currentFile,
      });
    }

    // Match warnings: "LaTeX Warning: ..."
    const warnMatch = line.match(/LaTeX Warning:\s+(.+)/);
    if (warnMatch) {
      let warnLine = 0;
      const lineNumMatch = line.match(/on input line (\d+)/);
      if (lineNumMatch) warnLine = parseInt(lineNumMatch[1], 10);
      // If line number not in same line, check next lines
      if (!lineNumMatch) {
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const nextMatch = lines[j].match(/on input line (\d+)/);
          if (nextMatch) { warnLine = parseInt(nextMatch[1], 10); break; }
        }
      }
      results.push({
        line: warnLine,
        message: warnMatch[1].replace(/\s+on input line \d+\.?$/, '').trim(),
        severity: 'warning',
        file: currentFile,
      });
    }

    // Match "Underfull \hbox" and "Overfull \hbox" warnings
    const hboxMatch = line.match(/(Underfull|Overfull) \\[hv]box .+ at lines? (\d+)/);
    if (hboxMatch) {
      results.push({
        line: parseInt(hboxMatch[2], 10),
        message: `${hboxMatch[1]} box detected`,
        severity: 'warning',
        file: currentFile,
      });
    }
  }

  return results;
}