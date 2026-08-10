const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/index');

test('health check', async () => {
  const res = await request(app).get('/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ok');
});

test('register creates a new user', async () => {
  const res = await request(app).post('/auth/register').send({
    name: 'Test User',
    email: `test-${Date.now()}@example.com`,
    password: 'password123',
  });
  assert.strictEqual(res.status, 201);
  assert.ok(res.body.id);
  assert.strictEqual(res.body.name, 'Test User');
});

test('register rejects short password', async () => {
  const res = await request(app).post('/auth/register').send({
    name: 'Test User',
    email: `test-${Date.now()}@example.com`,
    password: 'short',
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
});

test('register rejects duplicate email', async () => {
  const email = `dup-${Date.now()}@example.com`;
  await request(app).post('/auth/register').send({
    name: 'First',
    email,
    password: 'password123',
  });
  const res = await request(app).post('/auth/register').send({
    name: 'Second',
    email,
    password: 'password123',
  });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error.code, 'EMAIL_TAKEN');
});

test('login succeeds with correct credentials and returns a token', async () => {
  const email = `login-${Date.now()}@example.com`;
  await request(app).post('/auth/register').send({
    name: 'Login Test',
    email,
    password: 'password123',
  });

  const res = await request(app).post('/auth/login').send({ email, password: 'password123' });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.token);
});

test('login fails with wrong password', async () => {
  const email = `wrongpass-${Date.now()}@example.com`;
  await request(app).post('/auth/register').send({
    name: 'Wrong Pass',
    email,
    password: 'password123',
  });

  const res = await request(app).post('/auth/login').send({ email, password: 'nottherightone' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
});

test('verify and me work with a valid token, reject without one', async () => {
  const email = `verify-${Date.now()}@example.com`;
  await request(app).post('/auth/register').send({
    name: 'Verify Test',
    email,
    password: 'password123',
  });
  const loginRes = await request(app).post('/auth/login').send({ email, password: 'password123' });
  const token = loginRes.body.token;

  const verifyRes = await request(app).get('/auth/verify').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(verifyRes.status, 200);
  assert.strictEqual(verifyRes.body.valid, true);

  const meRes = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(meRes.status, 200);
  assert.strictEqual(meRes.body.email, email);

  const noAuthRes = await request(app).get('/auth/me');
  assert.strictEqual(noAuthRes.status, 401);
});