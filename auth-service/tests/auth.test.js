const test = require('node:test');
const { before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const { app, migrate, pool } = require('../src/index');

before(async () => {
  await migrate();
});

beforeEach(async () => {
  // ON DELETE CASCADE on refresh_tokens/email_verification_tokens means
  // clearing users is enough to clean up everything tied to them.
  await pool.query('DELETE FROM users');
});

after(async () => {
  await pool.end();
});

async function registerUser(overrides = {}) {
  return request(app)
    .post('/auth/register')
    .send({ name: 'Test User', email: 'test@example.com', password: 'password123', ...overrides });
}

// Pulls the raw verification token straight out of the database, since
// in real life this only ever appears in the "email" (here, a console log)
// - tests reach into the DB to simulate "the user clicked the link."
async function getVerificationTokenHashForUser(email) {
  const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  const tokenRes = await pool.query('SELECT token_hash, expires_at FROM email_verification_tokens WHERE user_id = $1', [
    userRes.rows[0].id,
  ]);
  return tokenRes.rows[0];
}

test('health check', async () => {
  const res = await request(app).get('/health');
  assert.strictEqual(res.status, 200);
});

test('register creates a new unverified user and an email verification token', async () => {
  const res = await registerUser();
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.emailVerified, false);

  const tokenRow = await getVerificationTokenHashForUser('test@example.com');
  assert.ok(tokenRow, 'expected a verification token to be created');
});

test('register rejects short password', async () => {
  const res = await registerUser({ password: 'short' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('register rejects duplicate email', async () => {
  await registerUser();
  const res = await registerUser({ name: 'Someone Else' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error.code, 'EMAIL_TAKEN');
});

test('verify-email rejects an invalid token', async () => {
  const res = await request(app).get('/auth/verify-email').query({ token: 'not-a-real-token' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'INVALID_OR_EXPIRED_TOKEN');
});

test('verify-email succeeds with a valid token, marks the account verified, and is single-use', async () => {
  // The verification token only ever appears in the "email" we log - this
  // captures that console output to simulate the user clicking the link,
  // rather than reaching into the database to read the raw token (which
  // isn't even stored - only its hash is).
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
    originalLog(...args);
  };
  await registerUser();
  console.log = originalLog;

  const logLine = logs.find((l) => l.includes('verification link for test@example.com'));
  assert.ok(logLine, 'expected the verification link to be logged');
  const token = new URL(logLine.split(': ').slice(1).join(':').trim()).searchParams.get('token');

  const verifyRes = await request(app).get('/auth/verify-email').query({ token });
  assert.strictEqual(verifyRes.status, 200);
  assert.strictEqual(verifyRes.body.verified, true);

  const loginRes = await request(app).post('/auth/login').send({ email: 'test@example.com', password: 'password123' });
  assert.strictEqual(loginRes.body.emailVerified, true);

  // Single-use: the same link can't be replayed.
  const secondAttemptRes = await request(app).get('/auth/verify-email').query({ token });
  assert.strictEqual(secondAttemptRes.status, 400);
});

test('login succeeds and returns both an access token and a refresh token', async () => {
  await registerUser();
  const res = await request(app).post('/auth/login').send({ email: 'test@example.com', password: 'password123' });

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.accessToken);
  assert.ok(res.body.refreshToken);
  assert.strictEqual(res.body.emailVerified, false); // hasn't verified in this test
});

test('login fails with wrong password', async () => {
  await registerUser();
  const res = await request(app).post('/auth/login').send({ email: 'test@example.com', password: 'wrongpassword' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
});

test('verify and me work with a valid access token, reject without one', async () => {
  await registerUser();
  const loginRes = await request(app).post('/auth/login').send({ email: 'test@example.com', password: 'password123' });
  const { accessToken } = loginRes.body;

  const verifyRes = await request(app).get('/auth/verify').set('Authorization', `Bearer ${accessToken}`);
  assert.strictEqual(verifyRes.status, 200);
  assert.strictEqual(verifyRes.body.valid, true);

  const meRes = await request(app).get('/auth/me').set('Authorization', `Bearer ${accessToken}`);
  assert.strictEqual(meRes.status, 200);
  assert.strictEqual(meRes.body.email, 'test@example.com');
  assert.strictEqual(meRes.body.emailVerified, false);

  const noAuthRes = await request(app).get('/auth/me');
  assert.strictEqual(noAuthRes.status, 401);
});

test('refresh issues a new access token and rotates the refresh token', async () => {
  await registerUser();
  const loginRes = await request(app).post('/auth/login').send({ email: 'test@example.com', password: 'password123' });
  const oldRefreshToken = loginRes.body.refreshToken;

  const refreshRes = await request(app).post('/auth/refresh').send({ refreshToken: oldRefreshToken });
  assert.strictEqual(refreshRes.status, 200);
  assert.ok(refreshRes.body.accessToken);
  assert.ok(refreshRes.body.refreshToken);
  assert.notStrictEqual(refreshRes.body.refreshToken, oldRefreshToken, 'expected a rotated (different) refresh token');

  // The old refresh token should no longer work - reuse is rejected.
  const reuseRes = await request(app).post('/auth/refresh').send({ refreshToken: oldRefreshToken });
  assert.strictEqual(reuseRes.status, 401);
  assert.strictEqual(reuseRes.body.error.code, 'INVALID_REFRESH_TOKEN');
});

test('refresh rejects an unknown token', async () => {
  const res = await request(app).post('/auth/refresh').send({ refreshToken: 'made-up-token' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'INVALID_REFRESH_TOKEN');
});

test('logout revokes the refresh token so it can no longer be used', async () => {
  await registerUser();
  const loginRes = await request(app).post('/auth/login').send({ email: 'test@example.com', password: 'password123' });
  const { refreshToken } = loginRes.body;

  const logoutRes = await request(app).post('/auth/logout').send({ refreshToken });
  assert.strictEqual(logoutRes.status, 200);
  assert.strictEqual(logoutRes.body.loggedOut, true);

  const refreshAfterLogoutRes = await request(app).post('/auth/refresh').send({ refreshToken });
  assert.strictEqual(refreshAfterLogoutRes.status, 401);
});