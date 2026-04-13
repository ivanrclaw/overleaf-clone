import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db';
import { authMiddleware, RequestWithUser } from '../middleware/auth';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'overleaf-clone-secret-key-change-in-prod';

function generateToken(user: { id: number; email: string }): string {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/auth/register
router.post('/register', (req: Request, res: Response): void => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  // Check if email already exists
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  const insert = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
  const result = insert.run(email, passwordHash);

  const user = { id: Number(result.lastInsertRowid), email };
  const token = generateToken(user);

  res.status(201).json({ token, user });
});

// POST /api/auth/login
router.post('/login', (req: Request, res: Response): void => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const row = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email) as
    | { id: number; email: string; password_hash: string }
    | undefined;

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const user = { id: row.id, email: row.email };
  const token = generateToken(user);

  res.json({ token, user });
});

// GET /api/auth/me (protected)
router.get('/me', authMiddleware, (req: Request, res: Response): void => {
  const user = (req as RequestWithUser).user;
  res.json({ user: { id: user.id, email: user.email } });
});

export default router;