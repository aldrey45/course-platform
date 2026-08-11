const express = require('express');
const Redis = require('ioredis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3003;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// --- In-memory notification log ---
// Not in API-CONTRACTS.md as a real endpoint, but useful for local dev/CI
// so we can actually verify a message was consumed without reading logs.
const receivedNotifications = [];

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notification-service' });
});

// Debug/visibility endpoint - not part of the public contract, just handy
// for confirming the consumer is working during development.
app.get('/notifications', (req, res) => {
  res.json(receivedNotifications);
});

// A dedicated connection is required for pub/sub in Redis/ioredis - once a
// client calls .subscribe(), that connection can only be used for
// subscription commands, so publishers always need a separate client.
const subscriber = new Redis(REDIS_URL, { retryStrategy: (times) => Math.min(times * 200, 2000) });

subscriber.on('error', (err) => {
  console.warn('[notification-service] Redis connection error:', err.message);
});

function handleEnrollmentCreated(message) {
  let event;
  try {
    event = JSON.parse(message);
  } catch (err) {
    console.warn('[notification-service] received malformed event, skipping:', message);
    return;
  }

  // Stand-in for a real notification (email/push/etc). For this learning
  // project we just log it and keep it in memory for the /notifications view.
  console.log(`[notification-service] Welcome ${event.userId} to "${event.courseTitle}"!`);
  receivedNotifications.push({ ...event, receivedAt: new Date().toISOString() });
}

async function start() {
  await subscriber.subscribe('enrollment.created');
  subscriber.on('message', (channel, message) => {
    if (channel === 'enrollment.created') {
      handleEnrollmentCreated(message);
    }
  });
  console.log('[notification-service] subscribed to enrollment.created');
}

if (require.main === module) {
  start().catch((err) => console.error('[notification-service] failed to start subscriber:', err));
  app.listen(PORT, () => console.log(`notification-service listening on ${PORT}`));
}

module.exports = { app, start, subscriber, receivedNotifications };