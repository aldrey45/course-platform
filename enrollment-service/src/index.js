const express = require('express');
const axios = require('axios');
const Redis = require('ioredis');
require('dotenv').config();
const { pool, migrate } = require('./db');
const { checkCourseExists, breaker } = require('./courseServiceClient');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const COURSE_SERVICE_URL = process.env.COURSE_SERVICE_URL || 'http://localhost:8000';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// --- Redis publisher (async event step) ---
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

// Sync HTTP call #1 - confirm the caller's token is valid
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

  // Sync HTTP call #2 - confirm the course exists, grab its title for
  // denormalized storage (see API-CONTRACTS.md design decisions).
  // Wrapped in a circuit breaker: if Course Service is repeatedly failing
  // or timing out, the breaker "opens" and this call fails fast instead
  // of piling up slow/hanging requests against a service that's already
  // struggling. See courseServiceClient.js for the breaker config.
  let courseTitle;
  try {
    const courseResult = await checkCourseExists(courseId);
    if (!courseResult.exists) {
      return errorResponse(res, 404, 'COURSE_NOT_FOUND', 'course does not exist');
    }
    courseTitle = courseResult.title;
  } catch (err) {
    if (breaker.opened) {
      return errorResponse(
        res,
        503,
        'COURSE_SERVICE_CIRCUIT_OPEN',
        'course service is temporarily unavailable, please try again shortly'
      );
    }
    return errorResponse(res, 502, 'COURSE_SERVICE_UNAVAILABLE', 'could not reach course service');
  }

  let enrollment;
  try {
    const result = await pool.query(
      `INSERT INTO enrollments (user_id, course_id, course_title, status, progress)
       VALUES ($1, $2, $3, 'active', 0)
       RETURNING id, user_id AS "userId", course_id AS "courseId", course_title AS "courseTitle", status, progress, enrolled_at AS "enrolledAt"`,
      [auth.userId, courseId, courseTitle]
    );
    enrollment = result.rows[0];
  } catch (err) {
    console.error('[enrollment-service] insert error:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'something went wrong');
  }

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

  try {
    const result = await pool.query(
      `SELECT id, course_id AS "courseId", course_title AS "courseTitle", status, progress
       FROM enrollments WHERE user_id = $1 ORDER BY id`,
      [auth.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[enrollment-service] list error:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'something went wrong');
  }
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

  try {
    const status = percent === 100 ? 'completed' : 'active';
    const result = await pool.query(
      `UPDATE enrollments SET progress = $1, status = $2, updated_at = now()
       WHERE id = $3 AND user_id = $4
       RETURNING id, progress`,
      [percent, status, req.params.id, auth.userId]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, 404, 'ENROLLMENT_NOT_FOUND', 'enrollment not found');
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[enrollment-service] progress update error:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'something went wrong');
  }
});

async function start() {
  await migrate();
  app.listen(PORT, () => console.log(`enrollment-service listening on ${PORT}`));
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[enrollment-service] failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = { app, migrate, pool, breaker };