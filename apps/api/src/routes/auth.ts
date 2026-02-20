import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { getJwtSecret } from '../lib/jwt';
import rateLimit from 'express-rate-limit';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
});

const router = Router();

const signToken = (payload: { userId: number; accountId: number; email: string }) => {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
};

router.post('/register', authLimiter, async (req, res) => {
  const { email, password, account_name } = req.body || {};
  if (!email || !password || !account_name) {
    return res.status(400).json({ error: 'Missing email, password or account_name' });
  }
  if (typeof email !== 'string' || typeof password !== 'string' || typeof account_name !== 'string') {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rowCount) return res.status(409).json({ error: 'Email already registered' });

    const accountResult = await pool.query('INSERT INTO accounts (name) VALUES ($1) RETURNING id, name', [
      account_name.trim(),
    ]);
    const accountId = accountResult.rows[0].id as number;

    const hash = await bcrypt.hash(password, 12);
    const userResult = await pool.query(
      'INSERT INTO users (account_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email',
      [accountId, email.toLowerCase(), hash]
    );
    const userId = userResult.rows[0].id as number;

    const token = signToken({ userId, accountId, email: email.toLowerCase() });
    return res.json({ token, user: { id: userId, email: email.toLowerCase() }, account: { id: accountId } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
  if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Invalid payload' });

  try {
    const result = await pool.query(
      'SELECT id, account_id, email, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (!(result.rowCount || 0)) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({ userId: user.id, accountId: user.account_id, email: user.email });
    return res.json({ token, user: { id: user.id, email: user.email }, account: { id: user.account_id } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const auth = req.auth!;
  return res.json({ user: { id: auth.userId, email: auth.email }, account: { id: auth.accountId } });
});

export default router;

