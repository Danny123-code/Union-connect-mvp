// Dependency-free auth helpers: password hashing via Node's built-in
// crypto.scrypt (no bcrypt/native module needed), opaque session tokens
// stored server-side, and hand-rolled cookie parsing so we don't need
// the `cookie-parser` package either. Keeps the dependency list at
// exactly cors + express + nanoid, which is what made this app reliable
// to deploy in the first place.

const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const hashBuffer = Buffer.from(hash, 'hex');
  const suppliedBuffer = crypto.scryptSync(password, salt, 64);
  if (hashBuffer.length !== suppliedBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, suppliedBuffer);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  generateId,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  SESSION_MAX_AGE_SECONDS
};
