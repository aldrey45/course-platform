const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const COURSE_SERVICE_URL = process.env.COURSE_SERVICE_URL || 'http://localhost:8000';
const ENROLLMENT_SERVICE_URL = process.env.ENROLLMENT_SERVICE_URL || 'http://localhost:3002';

app.use(rateLimit({ windowMs: 60 * 1000, max: 100 }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway' });
});

// Public-facing routes only. Note: /auth/verify and /courses/:id/exists
// are internal-only per API-CONTRACTS.md and are NOT proxied here.
app.use('/auth', createProxyMiddleware({ target: AUTH_SERVICE_URL, changeOrigin: true }));
app.use('/courses', createProxyMiddleware({ target: COURSE_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/courses': '/api/courses' } }));
app.use('/enrollments', createProxyMiddleware({ target: ENROLLMENT_SERVICE_URL, changeOrigin: true }));

app.listen(PORT, () => console.log(`gateway listening on ${PORT}`));

module.exports = app;
