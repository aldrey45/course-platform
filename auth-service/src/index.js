const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { pool, migrate } = require('./db');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-shared-across-services';
const JWT_EXPIRES_IN = '1h';

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'auth-service' });
});

// POST /auth/register
app.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'name, email, and password are required');
  }
  if (password.length < 8) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'password must be at least 8 characters');
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return errorResponse(res, 409, 'EMAIL_TAKEN', 'an account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, passwordHash]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[auth-service] register error:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'something went wrong');
  }
});

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'email and password are required');
  }

  try {
    const result = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return errorResponse(res, 401, 'INVALID_CREDENTIALS', 'email or password is incorrect');
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return errorResponse(res, 401, 'INVALID_CREDENTIALS', 'email or password is incorrect');
    }

    const token = jwt.sign({ userId: String(user.id), email: user.email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    return res.json({ token, expiresIn: JWT_EXPIRES_IN });
  } catch (err) {
    console.error('[auth-service] login error:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'something went wrong');
  }
});

// Same middleware as before - token verification doesn't touch the
// database at all, it's pure JWT signature checking.
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return errorResponse(res, 401, 'UNAUTHORIZED', 'missing or malformed Authorization header');
  }

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return errorResponse(res, 401, 'INVALID_TOKEN', 'token is invalid or expired');
  }
}

// GET /auth/verify - internal use by other services
app.get('/auth/verify', requireAuth, (req, res) => {
  res.json({ valid: true, userId: req.auth.userId, email: req.auth.email });
});

// GET /auth/me
app.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [req.auth.userId]);
    const user = result.rows[0];

    if (!user) {
      return errorResponse(res, 404, 'USER_NOT_FOUND', 'user no longer exists');
    }

    res.json(user);
  } catch (err) {
    console.error('[auth-service] me error:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'something went wrong');
  }
});

async function start() {
  await migrate();
  app.listen(PORT, () => console.log(`auth-service listening on ${PORT}`));
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[auth-service] failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = { app, migrate, pool };