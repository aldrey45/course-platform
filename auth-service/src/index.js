const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-shared-across-services';
const JWT_EXPIRES_IN = '1h';

// --- In-memory "database" ---
// Learning-project shortcut: no persistence, resets on restart.
// Swap this for a real DB (e.g. SQLite/Postgres) once you're comfortable
// with the auth flow itself.
const users = []; // { id, name, email, passwordHash }
let nextId = 1;

function findUserByEmail(email) {
  return users.find((u) => u.email === email);
}

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
  if (findUserByEmail(email)) {
    return errorResponse(res, 409, 'EMAIL_TAKEN', 'an account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: String(nextId++), name, email, passwordHash };
  users.push(user);

  return res.status(201).json({ id: user.id, name: user.name, email: user.email });
});

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'email and password are required');
  }

  const user = findUserByEmail(email);
  if (!user) {
    return errorResponse(res, 401, 'INVALID_CREDENTIALS', 'email or password is incorrect');
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return errorResponse(res, 401, 'INVALID_CREDENTIALS', 'email or password is incorrect');
  }

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

  return res.json({ token, expiresIn: JWT_EXPIRES_IN });
});

// Shared middleware: extracts and verifies the Bearer token.
// Used by both /auth/verify and /auth/me, and is the same pattern
// other services will follow when they need to check a token.
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
app.get('/auth/me', requireAuth, (req, res) => {
  const user = users.find((u) => u.id === req.auth.userId);
  if (!user) {
    return errorResponse(res, 404, 'USER_NOT_FOUND', 'user no longer exists');
  }
  res.json({ id: user.id, name: user.name, email: user.email });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`auth-service listening on ${PORT}`));
}

module.exports = app;