import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { authMiddleware, optionalAuthMiddleware, RequestWithUser } from '../middleware/auth';

const router = Router();

// Authenticated routes
router.use((req, res, next) => {
  // Skip auth for invite preview (GET /invite/:token)
  if (req.path.match(/^\/invite\/[^/]+$/) && req.method === 'GET') {
    return optionalAuthMiddleware(req, res, next);
  }
  return authMiddleware(req, res, next);
});

// GET /api/share/project/:projectId/members — list project members
router.get('/project/:projectId/members', (req: Request, res: Response): void => {
  const user = (req as RequestWithUser).user;
  const projectId = Number(req.params.projectId);

  // Verify user has access (owner or member)
  const membership = db.prepare(
    `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`
  ).get(projectId, user.id) as { role: string } | undefined;

  if (!membership) {
    res.status(403).json({ error: 'You do not have access to this project' });
    return;
  }

  const members = db.prepare(`
    SELECT pm.role, pm.created_at, u.id as user_id, u.email, u.display_name
    FROM project_members pm
    JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ?
    ORDER BY CASE WHEN pm.role = 'owner' THEN 0 WHEN pm.role = 'editor' THEN 1 ELSE 2 END
  `).all(projectId);

  // Get active share links
  const shareLinks = db.prepare(`
    SELECT sl.id, sl.token, sl.role, sl.expires_at, sl.created_at, u.email as created_by_email
    FROM share_links sl
    JOIN users u ON sl.created_by = u.id
    WHERE sl.project_id = ? AND (sl.expires_at IS NULL OR sl.expires_at > datetime('now'))
    ORDER BY sl.created_at DESC
  `).all(projectId);

  res.json({
    members,
    shareLinks,
    currentUserRole: membership.role,
  });
});

// POST /api/share/project/:projectId/link — generate a share link
router.post('/project/:projectId/link', (req: Request, res: Response): void => {
  const user = (req as RequestWithUser).user;
  const projectId = Number(req.params.projectId);
  const { role = 'viewer', expiresInHours } = req.body;

  if (!['viewer', 'editor'].includes(role)) {
    res.status(400).json({ error: 'Role must be viewer or editor' });
    return;
  }

  // Only owners and editors can create share links
  const membership = db.prepare(
    `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`
  ).get(projectId, user.id) as { role: string } | undefined;

  if (!membership || (membership.role !== 'owner' && membership.role !== 'editor')) {
    res.status(403).json({ error: 'Only owners and editors can create share links' });
    return;
  }

  // Verify project exists
  const project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const token = uuidv4();
  const expiresAt = expiresInHours
    ? new Date(Date.now() + expiresInHours * 3600000).toISOString()
    : null;

  db.prepare(
    'INSERT INTO share_links (project_id, token, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(projectId, token, role, user.id, expiresAt);

  const shareLink = db.prepare('SELECT * FROM share_links WHERE token = ?').get(token);
  res.status(201).json({ shareLink });
});

// DELETE /api/share/link/:linkId — revoke a share link
router.delete('/link/:linkId', (req: Request, res: Response): void => {
  const user = (req as RequestWithUser).user;
  const linkId = Number(req.params.linkId);

  const link = db.prepare(
    `SELECT sl.*, pm.role as member_role FROM share_links sl
     JOIN project_members pm ON sl.project_id = pm.project_id AND pm.user_id = ?
     WHERE sl.id = ?`
  ).get(user.id, linkId) as any;

  if (!link) {
    res.status(404).json({ error: 'Share link not found or you do not have permission' });
    return;
  }

  if (link.member_role !== 'owner' && link.member_role !== 'editor') {
    res.status(403).json({ error: 'Only owners and editors can revoke share links' });
    return;
  }

  db.prepare('DELETE FROM share_links WHERE id = ?').run(linkId);
  res.json({ ok: true });
});

// GET /api/share/invite/:token — get invite info (public, no auth required)
router.get('/invite/:token', (req: Request, res: Response): void => {
  const { token } = req.params;

  const link = db.prepare(`
    SELECT sl.*, p.name as project_name, u.email as owner_email, u.display_name as owner_name
    FROM share_links sl
    JOIN projects p ON sl.project_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE sl.token = ? AND (sl.expires_at IS NULL OR sl.expires_at > datetime('now'))
  `).get(token) as any;

  if (!link) {
    res.status(404).json({ error: 'Invite not found or expired' });
    return;
  }

  res.json({
    projectName: link.project_name,
    ownerEmail: link.owner_email,
    ownerName: link.owner_name,
    role: link.role,
    projectId: link.project_id,
  });
});

// POST /api/share/invite/:token/accept — accept a share invite (requires auth)
router.post('/invite/:token/accept', (req: Request, res: Response): void => {
  const user = (req as RequestWithUser).user;
  const { token } = req.params;

  const link = db.prepare(`
    SELECT * FROM share_links
    WHERE token = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).get(token) as any;

  if (!link) {
    res.status(404).json({ error: 'Invite not found or expired' });
    return;
  }

  // Check if already a member
  const existing = db.prepare(
    'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?'
  ).get(link.project_id, user.id) as any;

  if (existing) {
    // Already a member — return project info
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(link.project_id);
    res.json({
      project,
      role: existing.role,
      alreadyMember: true,
    });
    return;
  }

  // Add user as member
  db.prepare(
    'INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)'
  ).run(link.project_id, user.id, link.role);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(link.project_id);
  res.status(201).json({
    project,
    role: link.role,
    alreadyMember: false,
  });
});

// PATCH /api/share/project/:projectId/members/:userId — update member role
router.patch('/project/:projectId/members/:userId', (req: Request, res: Response): void => {
  const user = (req as RequestWithUser).user;
  const projectId = Number(req.params.projectId);
  const targetUserId = Number(req.params.userId);
  const { role } = req.body;

  if (!['viewer', 'editor'].includes(role)) {
    res.status(400).json({ error: 'Role must be viewer or editor' });
    return;
  }

  // Only owners can change roles
  const membership = db.prepare(
    `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`
  ).get(projectId, user.id) as { role: string } | undefined;

  if (!membership || membership.role !== 'owner') {
    res.status(403).json({ error: 'Only the project owner can change member roles' });
    return;
  }

  // Cannot change the owner's role
  const project = db.prepare('SELECT user_id FROM projects WHERE id = ?').get(projectId) as any;
  if (project && project.user_id === targetUserId) {
    res.status(400).json({ error: 'Cannot change the project owner\'s role' });
    return;
  }

  const result = db.prepare(
    'UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?'
  ).run(role, projectId, targetUserId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }

  res.json({ ok: true, role });
});

// DELETE /api/share/project/:projectId/members/:userId — remove member
router.delete('/project/:projectId/members/:userId', (req: Request, res: Response): void => {
  const user = (req as RequestWithUser).user;
  const projectId = Number(req.params.projectId);
  const targetUserId = Number(req.params.userId);

  // Only owners can remove members (or users removing themselves)
  const membership = db.prepare(
    `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`
  ).get(projectId, user.id) as { role: string } | undefined;

  if (!membership) {
    res.status(403).json({ error: 'You do not have access to this project' });
    return;
  }

  if (membership.role !== 'owner' && user.id !== targetUserId) {
    res.status(403).json({ error: 'Only the project owner can remove members' });
    return;
  }

  // Cannot remove the owner
  const project = db.prepare('SELECT user_id FROM projects WHERE id = ?').get(projectId) as any;
  if (project && project.user_id === targetUserId) {
    res.status(400).json({ error: 'Cannot remove the project owner. Transfer ownership first.' });
    return;
  }

  db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?')
    .run(projectId, targetUserId);

  res.json({ ok: true });
});

// GET /api/share/projects — list projects shared with current user
router.get('/projects', (req: Request, res: Response): void => {
  const user = (req as RequestWithUser).user;

  const sharedProjects = db.prepare(`
    SELECT p.*, pm.role as member_role
    FROM project_members pm
    JOIN projects p ON pm.project_id = p.id
    WHERE pm.user_id = ? AND p.user_id != ?
    ORDER BY p.updated_at DESC
  `).all(user.id, user.id);

  res.json({ projects: sharedProjects });
});

export default router;