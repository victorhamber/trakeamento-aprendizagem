import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../lib/jwt';

export type AuthUser = {
  userId: number;
  accountId: number;
  email: string;
};

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthUser;
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = header.slice('Bearer '.length);
  const secret = getJwtSecret();

  try {
    const payload = jwt.verify(token, secret) as AuthUser;
    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

