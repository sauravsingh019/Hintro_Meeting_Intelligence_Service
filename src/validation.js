import { badRequest } from './errors.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const statusValues = new Set(['PENDING', 'IN_PROGRESS', 'COMPLETED']);

export function assertString(value, field, { minLength = 1 } = {}) {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw badRequest(`${field} is required`);
  }
  return value.trim();
}

export function assertOptionalString(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  return value.trim();
}

export function assertEmail(value, field = 'email') {
  const email = assertString(value, field);
  if (!emailPattern.test(email)) throw badRequest(`Invalid ${field}`);
  return email.toLowerCase();
}

export function assertIsoDateTime(value, field) {
  const date = assertString(value, field);
  if (!isoDatePattern.test(date)) throw badRequest(`Invalid ${field}`);
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) throw badRequest(`Invalid ${field}`);
  return parsed.toISOString();
}

export function assertArray(value, field) {
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array`);
  return value;
}

export function assertTranscript(transcript) {
  const items = assertArray(transcript, 'transcript');
  if (!items.length) throw badRequest('transcript must not be empty');
  return items.map((item, index) => {
    if (!item || typeof item !== 'object') throw badRequest(`transcript[${index}] must be an object`);
    return {
      timestamp: assertString(item.timestamp, `transcript[${index}].timestamp`),
      speaker: assertString(item.speaker, `transcript[${index}].speaker`),
      text: assertString(item.text, `transcript[${index}].text`),
    };
  });
}

export function assertStatus(value) {
  const status = assertString(value, 'status');
  if (!statusValues.has(status)) {
    throw badRequest('Invalid status value', { allowed: [...statusValues] });
  }
  return status;
}

export function assertPositiveInt(value, field, { min = 1, max = 100 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw badRequest(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function assertActionItemStatus(value) {
  return assertStatus(value);
}

export function buildPagination(query) {
  return {
    page: assertPositiveInt(query.page ?? 1, 'page', { min: 1, max: 100000 }),
    limit: assertPositiveInt(query.limit ?? 20, 'limit', { min: 1, max: 100 }),
  };
}
