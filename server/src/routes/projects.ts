import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import db from '../db';
import { authMiddleware, RequestWithUser } from '../middleware/auth';

const router = Router();
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
function getUser(req: any): { id: number; email: string } {
  return (req as unknown as RequestWithUser).user;
}

// All routes protected
router.use(authMiddleware);

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

  const insert = db.prepare('INSERT INTO projects (user_id, name, content) VALUES (?, ?, ?)');
  const result = insert.run(user.id, name.trim(), DEFAULT_LATEX_TEMPLATE);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ project });
});

// GET /api/projects/:id
router.get('/:id', (req, res: Response): void => {
  const user = getUser(req);
  const project = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, user.id) as any;

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  res.json({ project });
});

// PUT /api/projects/:id
router.put('/:id', (req, res: Response): void => {
  const user = getUser(req);
  const { content } = req.body;

  if (content === undefined || content === null) {
    res.status(400).json({ error: 'Content is required' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, user.id);

  if (!existing) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  db.prepare('UPDATE projects SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(content, req.params.id, user.id);

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

// POST /api/projects/:id/compile
router.post('/:id/compile', async (req, res: Response): Promise<void> => {
  const user = getUser(req);
  const project = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, user.id) as any;

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overleaf-compile-'));
  const texFile = path.join(tmpDir, 'main.tex');

  try {
    fs.writeFileSync(texFile, project.content);

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
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// POST /api/projects/:id/lint
router.post('/:id/lint', async (req, res: Response): Promise<void> => {
  const user = getUser(req);
  const project = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, user.id) as any;

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // Accept content from request body (for real-time linting of unsaved changes)
  const content = req.body.content !== undefined ? req.body.content : project.content;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overleaf-lint-'));
  const texFile = path.join(tmpDir, 'main.tex');

  try {
    fs.writeFileSync(texFile, content);

    // Check if chktex is available
    try {
      await execFileAsync('which', ['chktex'], { timeout: 5000 });
    } catch {
      // chktex not available - return empty diagnostics
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
        // If parsing fails, return empty
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
    // On any error, return empty diagnostics (don't crash)
    res.json({ diagnostics: [] });
  } finally {
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

export default router;