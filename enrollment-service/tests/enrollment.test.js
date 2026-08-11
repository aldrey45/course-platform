const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

let mockAuthServer, mockCourseServer, app, request;

// Enrollment Service calls Auth and Course over real HTTP, so instead of
// mocking axios itself, we spin up tiny real HTTP servers that stand in
// for those two services. This tests the actual request/response contract,
// not just that a function was called.
before(async () => {
  mockAuthServer = http.createServer((req, res) => {
    if (req.url === '/auth/verify') {
      if (req.headers.authorization === 'Bearer valid-token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ valid: true, userId: 'user-1', email: 'test@example.com' }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'INVALID_TOKEN', message: 'invalid token' } }));
      }
    } else {
      res.writeHead(404).end();
    }
  });

  mockCourseServer = http.createServer((req, res) => {
    if (req.url === '/api/courses/course-1/exists') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exists: true, title: 'Intro to Testing' }));
    } else if (req.url.startsWith('/api/courses/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exists: false }));
    } else {
      res.writeHead(404).end();
    }
  });

  await new Promise((resolve) => mockAuthServer.listen(0, resolve));
  await new Promise((resolve) => mockCourseServer.listen(0, resolve));

  process.env.AUTH_SERVICE_URL = `http://localhost:${mockAuthServer.address().port}`;
  process.env.COURSE_SERVICE_URL = `http://localhost:${mockCourseServer.address().port}`;
  process.env.REDIS_URL = 'redis://localhost:1'; // deliberately unreachable - publish should fail silently

  // Must require the app AFTER the env vars above are set, since
  // enrollment-service reads them once at module load time.
  app = require('../src/index');
  request = require('supertest');
});

after(async () => {
  mockAuthServer.close();
  mockCourseServer.close();
});

test('health check', async () => {
  const res = await request(app).get('/health');
  assert.strictEqual(res.status, 200);
});

test('enroll rejects missing Authorization header', async () => {
  const res = await request(app).post('/enrollments').send({ courseId: 'course-1' });
  assert.strictEqual(res.status, 401);
});

test('enroll rejects invalid token', async () => {
  const res = await request(app)
    .post('/enrollments')
    .set('Authorization', 'Bearer wrong-token')
    .send({ courseId: 'course-1' });
  assert.strictEqual(res.status, 401);
});

test('enroll rejects a course that does not exist', async () => {
  const res = await request(app)
    .post('/enrollments')
    .set('Authorization', 'Bearer valid-token')
    .send({ courseId: 'does-not-exist' });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'COURSE_NOT_FOUND');
});

test('enroll succeeds with valid token and existing course', async () => {
  const res = await request(app)
    .post('/enrollments')
    .set('Authorization', 'Bearer valid-token')
    .send({ courseId: 'course-1' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.courseTitle, 'Intro to Testing');
  assert.strictEqual(res.body.status, 'active');
});

test('GET /enrollments/me lists the enrollment just created', async () => {
  const res = await request(app).get('/enrollments/me').set('Authorization', 'Bearer valid-token');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.some((e) => e.courseId === 'course-1'));
});

test('PATCH progress updates and marks completed at 100', async () => {
  const listRes = await request(app).get('/enrollments/me').set('Authorization', 'Bearer valid-token');
  const enrollmentId = listRes.body[0].id;

  const res = await request(app)
    .patch(`/enrollments/${enrollmentId}/progress`)
    .set('Authorization', 'Bearer valid-token')
    .send({ percent: 100 });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.progress, 100);
});