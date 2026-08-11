const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

let mockAuth, mockCourse, mockEnrollment, app, request;

// Same approach as enrollment-service tests: real (tiny) mock upstream
// servers so we're testing actual proxying behavior, not a mocked function.
before(async () => {
  mockAuth = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ receivedPath: req.url, receivedMethod: req.method }));
  });

  mockCourse = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ receivedPath: req.url, receivedMethod: req.method }));
  });

  mockEnrollment = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ receivedPath: req.url, receivedMethod: req.method }));
  });

  await new Promise((resolve) => mockAuth.listen(0, resolve));
  await new Promise((resolve) => mockCourse.listen(0, resolve));
  await new Promise((resolve) => mockEnrollment.listen(0, resolve));

  process.env.AUTH_SERVICE_URL = `http://localhost:${mockAuth.address().port}`;
  process.env.COURSE_SERVICE_URL = `http://localhost:${mockCourse.address().port}`;
  process.env.ENROLLMENT_SERVICE_URL = `http://localhost:${mockEnrollment.address().port}`;

  app = require('../src/index');
  request = require('supertest');
});

after(async () => {
  mockAuth.close();
  mockCourse.close();
  mockEnrollment.close();
});

test('health check', async () => {
  const res = await request(app).get('/health');
  assert.strictEqual(res.status, 200);
});

test('proxies /auth/* through to auth service unchanged', async () => {
  const res = await request(app).post('/auth/login').send({ email: 'a@b.com' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.receivedPath, '/auth/login');
});

test('blocks /auth/verify at the gateway - never reaches auth service', async () => {
  const res = await request(app).get('/auth/verify');
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
});

test('proxies /courses/* to course service with /api prefix rewrite', async () => {
  const res = await request(app).get('/courses/course-1');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.receivedPath, '/api/courses/course-1');
});

test('blocks /courses/:id/exists at the gateway - never reaches course service', async () => {
  const res = await request(app).get('/courses/course-1/exists');
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
});

test('proxies /enrollments/* through to enrollment service unchanged', async () => {
  const res = await request(app).get('/enrollments/me');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.receivedPath, '/enrollments/me');
});