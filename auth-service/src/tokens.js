const crypto = require('crypto');

// Opaque tokens (not JWTs) for refresh tokens and email verification -
// just high-entropy random strings. We only ever store their SHA-256
// hash; the raw value exists only in the response sent to the client
// (or the "email" we log), same principle as never storing raw passwords.
function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { generateOpaqueToken, hashToken };