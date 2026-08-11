const express = require('express');
const axios = require('axios');
const Redis = require('ioredis');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const COURSE_SERVICE_URL = process.env.COURSE_SERVICE_URL || 'http://localhost:8000';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// --- In-memory "database" ---
// Same learning-project shortcut as auth-service: no persistence yet.
const enrollments = []; // { id, userId, courseId, courseTitle, status, progress, enrolledAt }
let nextId = 1;

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// --- Redis publisher (for the async event step) ---
// lazyConnect + an error handler so a missing/down Redis never crashes
// the service or blocks a request - it just fails to publish, quietly.
const redis = new Redis(REDIS_URL, { lazyConnect: true, retryStrategy: () => null });
redis.on('error', (err) => {
  console.warn('[enrollment-service] Redis unavailable, events will not be published:', err.message);
});

async function publishEnrollmentCreated(event) {
  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.publish('enrollment.created', JSON.stringify(event));
  } catch (err) {
    console.warn('[enrollment-service] failed to publish enrollment.created:', err.message);
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'enrollment-service' });
});

// Verifies the caller's token against Auth Service (sync HTTP call #1).
async function verifyToken(authHeader) {
  const response = await axios.get(`${AUTH_SERVICE_URL}/auth/verify`, {
    headers: { Authorization: authHeader },
  });
  return response.data; // { valid, userId, email }
}

// POST /enrollments
app.post('/enrollments', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { courseId } = req.body || {};

  if (!authHeader) {
    return errorResponse(res, 401, 'UNAUTHORIZED', 'missing Authorization header');
  }
  if (!courseId) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'courseId is required');
  }

  let auth;
  try {
    auth = await verifyToken(authHeader);
  } catch (err) {
    if (err.response) {
      return errorResponse(res, 401, 'UNAUTHORIZED', 'invalid or expired token');
    }
    return errorResponse(res, 502, 'AUTH_SERVICE_UNAVAILABLE', 'could not reach auth service');
  }

  // Sync HTTP call #2 - confirm the course exists and grab its title
  // for denormalized storage (see API-CONTRACTS.md design decisions).
  let courseTitle;
  try {
    const courseRes = await axios.get(`${COURSE_SERVICE_URL}/api/courses/${courseId}/exists`);
    if (!courseRes.data.exists) {
      return errorResponse(res, 404, 'COURSE_NOT_FOUND', 'course does not exist');
    }
    courseTitle = courseRes.data.title;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return errorResponse(res, 404, 'COURSE_NOT_FOUND', 'course does not exist');
    }
    return errorResponse(res, 502, 'COURSE_SERVICE_UNAVAILABLE', 'could not reach course service');
  }

  const enrollment = {
    id: String(nextId++),
    userId: auth.userId,
    courseId,
    courseTitle,
    status: 'active',
    progress: 0,
    enrolledAt: new Date().toISOString(),
  };
  enrollments.push(enrollment);

  // Async step - fire and forget, don't make the caller wait on Notification.
  publishEnrollmentCreated({
    userId: auth.userId,
    courseId,
    courseTitle,
    enrolledAt: enrollment.enrolledAt,
  });

  return res.status(201).json(enrollment);
});

// GET /enrollments/me
app.get('/enrollments/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return errorResponse(res, 401, 'UNAUTHORIZED', 'missing Authorization header');
  }

  let auth;
  try {
    auth = await verifyToken(authHeader);
  } catch (err) {
    if (err.response) {
      return errorResponse(res, 401, 'UNAUTHORIZED', 'invalid or expired token');
    }
    return errorResponse(res, 502, 'AUTH_SERVICE_UNAVAILABLE', 'could not reach auth service');
  }

  const mine = enrollments
    .filter((e) => e.userId === auth.userId)
    .map((e) => ({ id: e.id, courseId: e.courseId, courseTitle: e.courseTitle, status: e.status, progress: e.progress }));

  res.json(mine);
});

// PATCH /enrollments/:id/progress
app.patch('/enrollments/:id/progress', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { percent } = req.body || {};

  if (!authHeader) {
    return errorResponse(res, 401, 'UNAUTHORIZED', 'missing Authorization header');
  }
  if (typeof percent !== 'number' || percent < 0 || percent > 100) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'percent must be a number between 0 and 100');
  }

  let auth;
  try {
    auth = await verifyToken(authHeader);
  } catch (err) {
    if (err.response) {
      return errorResponse(res, 401, 'UNAUTHORIZED', 'invalid or expired token');
    }
    return errorResponse(res, 502, 'AUTH_SERVICE_UNAVAILABLE', 'could not reach auth service');
  }

  const enrollment = enrollments.find((e) => e.id === req.params.id && e.userId === auth.userId);
  if (!enrollment) {
    return errorResponse(res, 404, 'ENROLLMENT_NOT_FOUND', 'enrollment not found');
  }

  enrollment.progress = percent;
  if (percent === 100) enrollment.status = 'completed';

  res.json({ id: enrollment.id, progress: enrollment.progress });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`enrollment-service listening on ${PORT}`));
}

module.exports = app;