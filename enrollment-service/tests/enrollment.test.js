const test = require('node:test');
const { before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

let mockAuthServer, mockCourseServer, app, migrate, pool, request;

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
  process.env.REDIS_URL = 'redis://localhost:1'; // deliberately unreachable

  // Must require the app AFTER the env vars above are set.
  ({ app, migrate, pool } = require('../src/index'));
  request = require('supertest');

  await migrate();
});

// Real database now - clear between tests instead of relying on unique IDs.
beforeEach(async () => {
  await pool.query('DELETE FROM enrollments');
});

after(async () => {
  mockAuthServer.close();
  mockCourseServer.close();
  await pool.end();
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

test('enroll succeeds and persists to the database', async () => {
  const res = await request(app)
    .post('/enrollments')
    .set('Authorization', 'Bearer valid-token')
    .send({ courseId: 'course-1' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.courseTitle, 'Intro to Testing');
  assert.strictEqual(res.body.status, 'active');

  const dbCheck = await pool.query('SELECT * FROM enrollments WHERE id = $1', [res.body.id]);
  assert.strictEqual(dbCheck.rows.length, 1);
});

test('GET /enrollments/me lists only the requesting user\'s enrollments', async () => {
  await request(app).post('/enrollments').set('Authorization', 'Bearer valid-token').send({ courseId: 'course-1' });

  const res = await request(app).get('/enrollments/me').set('Authorization', 'Bearer valid-token');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.some((e) => e.courseId === 'course-1'));
});

test('PATCH progress updates and marks completed at 100', async () => {
  const enrollRes = await request(app)
    .post('/enrollments')
    .set('Authorization', 'Bearer valid-token')
    .send({ courseId: 'course-1' });

  const res = await request(app)
    .patch(`/enrollments/${enrollRes.body.id}/progress`)
    .set('Authorization', 'Bearer valid-token')
    .send({ percent: 100 });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.progress, 100);
});