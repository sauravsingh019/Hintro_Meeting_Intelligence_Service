import crypto from 'node:crypto';
import { unauthorized } from './errors.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function unbase64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signAuthToken(payload, secret) {
  const body = base64url(JSON.stringify(payload));
  const signature = signPayload(body, secret);
  return `${body}.${signature}`;
}

export function verifyAuthToken(token, secret) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) throw unauthorized('Missing or invalid token');
  const expected = signPayload(body, secret);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw unauthorized('Invalid token');
  }
  const payload = JSON.parse(unbase64url(body));
  if (payload.exp && Date.now() > payload.exp) {
    throw unauthorized('Token expired');
  }
  return payload;
}

export function getBearerToken(headerValue) {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue);
  return match ? match[1] : null;
}
