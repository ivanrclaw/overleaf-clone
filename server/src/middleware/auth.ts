import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'overleaf-clone-secret-key-change-in-prod';

export interface RequestWithUser extends Request {
  user: {
    id: number;
    email: string;
  };
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; email: string };
    (req as RequestWithUser).user = { id: decoded.id, email: decoded.email };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}