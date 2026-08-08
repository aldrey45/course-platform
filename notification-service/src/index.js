const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3003;

// Notification service has no meaningful public API - it's a listener.
// /health exists only so Docker/CI/gateway can check it's alive.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notification-service' });
});

// TODO: subscribe to Redis/RabbitMQ channel "enrollment.created"
// const Redis = require('ioredis');
// const sub = new Redis(process.env.REDIS_URL);
// sub.subscribe('enrollment.created');
// sub.on('message', (channel, message) => {
//   const event = JSON.parse(message);
//   console.log(`Sending welcome notification for enrollment:`, event);
// });

app.listen(PORT, () => console.log(`notification-service listening on ${PORT}`));

module.exports = app;
