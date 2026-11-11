// Password hashing (scrypt, built into Node) and cookie-based sessions.
const crypto = require('crypto');
const q = require('./db');

const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Used when the username doesn't exist, so the response takes as long as a real check.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((p) => p.trim().split('=')).filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  q.insertSession.run(token, userId, Date.now() + SESSION_TTL_MS);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
  });
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) q.deleteSession.run(token);
  res.clearCookie(SESSION_COOKIE);
}

// Attaches req.user if the request carries a valid session cookie.
function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    const session = q.findSession.get(token, Date.now());
    if (session) req.user = q.findUserById.get(session.user_id);
  }
  next();
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, createSession, destroySession, loadUser };
