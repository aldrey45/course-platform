const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Health check - every service should have one, Docker/CI will use this
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'auth-service' });
});

// TODO: implement per API-CONTRACTS.md
app.post('/auth/register', (req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'register not implemented yet' } });
});

app.post('/auth/login', (req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'login not implemented yet' } });
});

app.get('/auth/verify', (req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'verify not implemented yet' } });
});

app.get('/auth/me', (req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'me not implemented yet' } });
});

app.listen(PORT, () => console.log(`auth-service listening on ${PORT}`));

module.exports = app;
