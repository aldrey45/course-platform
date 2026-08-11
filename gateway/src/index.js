const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const COURSE_SERVICE_URL = process.env.COURSE_SERVICE_URL || 'http://localhost:8000';
const ENROLLMENT_SERVICE_URL = process.env.ENROLLMENT_SERVICE_URL || 'http://localhost:3002';

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

app.use(rateLimit({ windowMs: 60 * 1000, max: 100 }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway' });
});

// --- Block internal-only endpoints ---
// Per API-CONTRACTS.md: /auth/verify and /courses/:id/exists are for
// service-to-service calls only and must never be reachable from outside.
// These blockers are registered BEFORE the proxy routes below, so Express
// matches them first and the request never reaches the real service.
app.all('/auth/verify', (req, res) => {
  errorResponse(res, 404, 'NOT_FOUND', 'not found');
});

app.all(/^\/courses\/[^/]+\/exists$/, (req, res) => {
  errorResponse(res, 404, 'NOT_FOUND', 'not found');
});

// --- Public proxy routes ---
// Express strips the mount path (e.g. "/auth") from req.url before handing
// off to middleware mounted with app.use(path, ...). So by the time the
// proxy sees the request, "/auth/login" has already become just "/login".
// pathRewrite below adds the prefix back so the upstream service still
// receives the full path it expects.
app.use(
  '/auth',
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/': '/auth/' },
  })
);

app.use(
  '/courses',
  createProxyMiddleware({
    target: COURSE_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/': '/api/courses/' },
  })
);

app.use(
  '/enrollments',
  createProxyMiddleware({
    target: ENROLLMENT_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/': '/enrollments/' },
  })
);

if (require.main === module) {
  app.listen(PORT, () => console.log(`gateway listening on ${PORT}`));
}

module.exports = app;