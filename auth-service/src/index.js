const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { pool, migrate } = require('./db');
const { generateOpaqueToken, hashToken } = require('./tokens');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-shared-across-services';

// Access tokens are short-lived now that refresh tokens exist to renew
// them - if one leaks, the exposure window is small.
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Used to build the verification link we "send." The Gateway proxies
// /auth/* straight through to this service, so a link through the
// Gateway's public origin is what a real client would actually receive.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

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
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, email_verified AS "emailVerified"',
      [name, email, passwordHash]
    );
    const user = result.rows[0];

    // Issue and "send" an email verification link. No real email
    // provider is wired up yet - logging the link is a common dev-mode
    // stand-in for a mail catcher like Mailhog or Ethereal.
    const rawToken = generateOpaqueToken();
    await pool.query(
      'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, hashToken(rawToken), new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)]
    );
    console.log(
      `[auth-service] verification link for ${email}: ${PUBLIC_BASE_URL}/auth/verify-email?token=${rawToken}`
    );

    return res.status(201).json(user);
  } catch (err) {
    console.error('[auth-service] register error:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'something went wrong');
  }
});

// GET /auth/verify-email?token=...
app.get('/auth/verify-email', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'token is required');
  }

  try {
    const tokenHash = hashToken(token);
    const result = await pool.query(
      'SELECT id, user_id AS "userId" FROM email_verification_tokens WHERE token_hash = $1 AND expires_at > now()',
      [tokenHash]
    );
    const record = result.rows[0];

    if (!record) {
      return errorResponse(res, 400, 'INVALID_OR_EXPIRED_TOKEN', 'this verification link is invalid or has expired');
    }

    await pool.query('UPDATE users SET email_verified = true WHERE id = $1', [record.userId]);
    // Single-use - delete it so the same link can't be replayed.
    await pool.query('DELETE FROM email_verification_tokens WHERE id = $1', [record.id]);

    return res.json({ verified: true });
  } catch (err) {
    console.error('[auth-service] verify-email error:', err.message);
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
    const result = await pool.query(
      'SELECT id, email, password_hash, email_verified AS "emailVerified" FROM users WHERE email = $1',
      [email]
    );
    const user = result.rows[0];

    if (!user) {
      return errorResponse(res, 401, 'INVALID_CREDENTIALS', 'email or password is incorrect');
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return errorResponse(res, 401, 'INVALID_CREDENTIALS', 'email or password is incorrect');
    }

    // Login is allowed regardless of verification status - many real
    // platforms do the same and simply gate specific features (like
    // posting content) behind emailVerified, rather than blocking login
    // entirely. The client can check `emailVerified` in the response.
    const accessToken = jwt.sign({ userId: String(user.id), email: user.email }, JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });

    const rawRefreshToken = generateOpaqueToken();
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, hashToken(rawRefreshToken), new Date(Date.now() + REFRESH_TOKEN_TTL_MS)]
    );

    return res.json({
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      emailVerified: user.emailVerified,
    });
  } catch (err) {
    console.error('[auth-service] login error:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'something went wrong');
  }
});

// POST /auth/refresh
// Rotates the refresh token on every use: the old one is revoked and a
// new one issued, rather than reusing the same refresh token repeatedly.
// This limits how long a stolen refresh token stays useful - if the
// legitimate client and an attacker both try to use the same token, only
// the first one succeeds, and that reuse pattern is a common signal real
// systems use to detect theft.
app.post('/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'refreshToken is required');
  }

  try {
    const tokenHash = hashToken(refreshToken);
    const result = await pool.query(
      `SELECT id, user_id AS "userId" FROM refresh_tokens
       WHERE token_hash = $1 AND revoked = false AND expires_at > now()`,
      [tokenHash]
    );
    const record = result.rows[0];

    if (!record) {
      return errorResponse(res, 401, 'INVALID_REFRESH_TOKEN', 'refresh token is invalid, expired, or revoked');
    }

    const userResult = await pool.query('SELECT id, email FROM users WHERE id = $1', [record.userId]);
    const user = userResult.rows[0];
    if (!user) {
      return errorResponse(res, 401, 'INVALID_REFRESH_TOKEN', 'refresh token is invalid, expired, or revoked');
    }

    await pool.query('UPDATE refresh_tokens SET revoked = true WHERE id = $1', [record.id]);

    const newRawRefreshToken = generateOpaqueToken();
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, hashToken(newRawRefreshToken), new Date(Date.now() + REFRESH_TOKEN_TTL_MS)]
    );

    const accessToken = jwt.sign({ userId: String(user.id), email: user.email }, JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });

    return res.json({
      accessToken,
      refreshToken: newRawRefreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });
  } catch (err) {
    console.error('[auth-service] refresh error:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'something went wrong');
  }
});

// POST /auth/logout
app.post('/auth/logout', async (req, res) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'refreshToken is required');
  }

  try {
    // Always respond 200 regardless of whether the token existed - not
    // leaking whether a given refresh token was ever valid avoids giving
    // an attacker a way to probe for tokens.
    await pool.query('UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1', [hashToken(refreshToken)]);
    return res.json({ loggedOut: true });
  } catch (err) {
    console.error('[auth-service] logout error:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'something went wrong');
  }
});

// Shared middleware for endpoints that need a valid access token.
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

// GET /auth/verify - internal use by other services. Pure JWT signature
// check, no database hit - deliberately fast since Enrollment Service
// calls this synchronously on every enrollment request.
app.get('/auth/verify', requireAuth, (req, res) => {
  res.json({ valid: true, userId: req.auth.userId, email: req.auth.email });
});

// GET /auth/me
app.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, email_verified AS "emailVerified" FROM users WHERE id = $1',
      [req.auth.userId]
    );
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