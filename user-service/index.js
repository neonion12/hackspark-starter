import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool, { initDB } from './db.js';
import { centralFetch } from './centralApi.js';

const app = express();
app.use(express.json());

const PORT       = process.env.PORT || 8001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// P1: Health check
app.get('/status', (req, res) => {
  res.json({ service: 'user-service', status: 'OK' });
});

// ── Auth middleware ──────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// P2: Register
app.post('/users/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email, and password required' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// P2: Login
app.post('/users/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

// P2: Get profile
app.get('/users/me', authenticate, async (req, res) => {
  const result = await pool.query('SELECT id, name, email, created_at FROM users WHERE id = $1', [req.user.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(result.rows[0]);
});

// P6: Loyalty discount
app.get('/users/:id/discount', async (req, res) => {
  const { id } = req.params;
  try {
    const apiRes = await centralFetch(`/api/data/users/${id}`);
    if (apiRes.status === 404) return res.status(404).json({ error: 'User not found' });
    if (!apiRes.ok) return res.status(502).json({ error: 'Central API error' });

    const user = await apiRes.json();
    const score = user.securityScore;

    let discountPercent = 0;
    if (score >= 80)      discountPercent = 20;
    else if (score >= 60) discountPercent = 15;
    else if (score >= 40) discountPercent = 10;
    else if (score >= 20) discountPercent = 5;

    res.json({ userId: Number(id), securityScore: score, discountPercent });
  } catch (err) {
    if (err.status === 503) return res.status(503).json(err.body);
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start
initDB().then(() => {
  app.listen(PORT, () => console.log(`user-service running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});