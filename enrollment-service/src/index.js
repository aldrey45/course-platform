const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const COURSE_SERVICE_URL = process.env.COURSE_SERVICE_URL || 'http://localhost:8000';

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'enrollment-service' });
});

// TODO per API-CONTRACTS.md:
// 1. call AUTH_SERVICE_URL/auth/verify (sync)
// 2. call COURSE_SERVICE_URL/api/courses/:id/exists (sync)
// 3. save enrollment (denormalized courseTitle)
// 4. publish "enrollment.created" event (async, don't await consumers)
app.post('/enrollments', (req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'enroll not implemented yet' } });
});

app.get('/enrollments/me', (req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'list enrollments not implemented yet' } });
});

app.patch('/enrollments/:id/progress', (req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'progress update not implemented yet' } });
});

app.listen(PORT, () => console.log(`enrollment-service listening on ${PORT}`));

module.exports = app;
