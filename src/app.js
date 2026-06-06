import { createServer } from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import nodePath from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { Database } from './db.js';
import { createLogger } from './logger.js';
import { analyzeMeeting, validateAnalysisResult } from './ai.js';
import { buildOpenApiSpec } from './openapi.js';
import { createReminderScheduler } from './reminders.js';
import { createRateLimiter } from './rate-limit.js';
import { assertActionItemStatus, assertArray, assertEmail, assertIsoDateTime, assertOptionalString, assertPositiveInt, assertStatus, assertString, assertTranscript, buildPagination } from './validation.js';
import { badRequest, forbidden, notFound, unauthorized, conflict, AppError } from './errors.js';
import { getBearerToken, signAuthToken, verifyAuthToken, hashPassword, verifyPassword } from './security.js';

function jsonResponse(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function htmlResponse(res, statusCode, html) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('Malformed JSON request');
  }
}

function parseUrl(requestUrl) {
  return new URL(requestUrl, 'http://localhost');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Trace-Id',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  };
}

function normalizeError(error) {
  if (error instanceof AppError) return error;
  return new AppError(500, 'INTERNAL_ERROR', 'Internal server error');
}

function makeTraceId(headerValue) {
  return headerValue || crypto.randomUUID();
}

function encodeResponse(traceId, success, dataOrError) {
  if (success) {
    return { traceId, success: true, data: dataOrError };
  }
  return { traceId, success: false, error: dataOrError };
}

function htmlDocs() {
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Hintro API Docs</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; line-height: 1.6; }
        code, pre { background: #f6f8fa; padding: 2px 4px; border-radius: 4px; }
      </style>
    </head>
    <body>
      <h1>Hintro Meeting Intelligence Service</h1>
      <p>OpenAPI specification: <a href="/openapi.json">/openapi.json</a></p>
      <p>Authentication: Bearer token via <code>/api/auth/login</code>.</p>
      <ul>
        <li>Public: <code>/health</code>, <code>/openapi.json</code>, <code>/docs</code>, <code>/api/evaluation</code>, <code>/api/auth/login</code></li>
        <li>Protected: meetings, action items, analysis, reminders</li>
      </ul>
    </body>
  </html>`;
}

export function createApp({ database = new Database(), logger = createLogger(), startScheduler = true } = {}) {
  const scheduler = createReminderScheduler({ database, config, logger });
  const rateLimit = createRateLimiter({
    windowMs: config.rateLimitWindowMs,
    maxRequests: config.rateLimitMaxRequests,
  });
  if (startScheduler) scheduler.start();

  async function handler(req, res) {
    const traceId = makeTraceId(req.headers['x-trace-id']);
    const start = Date.now();
    const url = parseUrl(req.url || '/');
    const method = (req.method || 'GET').toUpperCase();
    const path = url.pathname;

    const baseHeaders = {
      ...corsHeaders(),
      'X-Trace-Id': traceId,
    };

    const clientKey = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const bucket = rateLimit(clientKey);
    if (!bucket.allowed && !['/health', '/openapi.json', '/docs'].includes(path)) {
      jsonResponse(
        res,
        429,
        encodeResponse(traceId, false, {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
        }),
        { ...baseHeaders, 'Retry-After': Math.ceil(bucket.retryAfterMs / 1000) },
      );
      return;
    }

    if (method === 'OPTIONS') {
      res.writeHead(204, baseHeaders);
      res.end();
      return;
    }

    try {
      logger.info('request_start', { traceId, method, path });

      const publicRoute = (
        path === '/' ||
        path === '/health' ||
        path === '/api/evaluation' ||
        path === '/openapi.json' ||
        path === '/docs' ||
        path === '/api/auth/login'
      );

      const authUser = publicRoute ? null : authenticate(req, config);

      if (method === 'GET' && path === '/') {
        const html = fs.readFileSync(nodePath.resolve(config.rootDir, 'src/dashboard.html'), 'utf8');
        htmlResponse(res, 200, html);
        return;
      }

      if (method === 'GET' && path === '/health') {
        jsonResponse(res, 200, encodeResponse(traceId, true, { status: 'UP' }), baseHeaders);
        return;
      }

      if (method === 'GET' && path === '/api/evaluation') {
        jsonResponse(res, 200, encodeResponse(traceId, true, {
          candidateName: config.candidateName,
          email: config.adminEmail,
          repositoryUrl: config.repositoryUrl,
          deployedUrl: config.deployedUrl,
          externalIntegration: config.reminderWebhookType === 'slack' ? 'Slack Webhook' : config.reminderWebhookType,
          features: ['Authentication', 'AI Analysis', 'Reminder Scheduler'],
        }), baseHeaders);
        return;
      }

      if (method === 'GET' && path === '/openapi.json') {
        jsonResponse(res, 200, buildOpenApiSpec(), baseHeaders);
        return;
      }

      if (method === 'GET' && path === '/docs') {
        htmlResponse(res, 200, htmlDocs());
        return;
      }

      if (method === 'POST' && path === '/api/auth/login') {
        const body = await readBody(req);
        const email = assertEmail(body.email);
        const password = assertString(body.password, 'password');
        const user = database.getUserByEmail(email);
        if (!user || !verifyPassword(password, user.password_hash)) {
          throw unauthorized('Invalid credentials');
        }
        const token = signAuthToken({ sub: user.id, email: user.email, exp: Date.now() + 1000 * 60 * 60 * 12 }, config.authSecret);
        jsonResponse(res, 200, encodeResponse(traceId, true, { token, tokenType: 'Bearer', expiresIn: 60 * 60 * 12 }), baseHeaders);
        return;
      }

      if (method === 'GET' && path === '/api/auth/me') {
        jsonResponse(res, 200, encodeResponse(traceId, true, { id: authUser.sub, email: authUser.email }), baseHeaders);
        return;
      }

      if (method === 'POST' && path === '/api/meetings') {
        const body = await readBody(req);
        const meeting = database.createMeeting({
          title: assertString(body.title, 'title'),
          meetingDate: assertIsoDateTime(body.meetingDate, 'meetingDate'),
          participants: assertArray(body.participants, 'participants').map((participant, index) => assertEmail(participant, `participants[${index}]`)),
          transcript: assertTranscript(body.transcript),
        });
        jsonResponse(res, 201, encodeResponse(traceId, true, meeting), baseHeaders);
        return;
      }

      if (method === 'GET' && path === '/api/meetings') {
        const { page, limit } = buildPagination(Object.fromEntries(url.searchParams));
        const result = database.listMeetings({
          page,
          limit,
          title: assertOptionalString(url.searchParams.get('title'), 'title'),
          participant: assertOptionalString(url.searchParams.get('participant'), 'participant'),
          from: url.searchParams.get('from') ? assertIsoDateTime(url.searchParams.get('from'), 'from') : undefined,
          to: url.searchParams.get('to') ? assertIsoDateTime(url.searchParams.get('to'), 'to') : undefined,
        });
        jsonResponse(res, 200, encodeResponse(traceId, true, result), baseHeaders);
        return;
      }

      const meetingMatch = path.match(/^\/api\/meetings\/([^/]+)$/);
      const meetingAnalyzeMatch = path.match(/^\/api\/meetings\/([^/]+)\/analyze$/);
      if (meetingMatch) {
        if (method === 'GET') {
          const meeting = database.getMeetingById(meetingMatch[1]);
          if (!meeting) throw notFound('Meeting not found');
          jsonResponse(res, 200, encodeResponse(traceId, true, meeting), baseHeaders);
          return;
        }
        if (method === 'DELETE') {
          const meeting = database.getMeetingById(meetingMatch[1]);
          if (!meeting) throw notFound('Meeting not found');
          database.deleteMeeting(meeting.id);
          jsonResponse(res, 200, encodeResponse(traceId, true, { message: 'Meeting deleted successfully' }), baseHeaders);
          return;
        }
      }

      if (method === 'POST' && meetingAnalyzeMatch) {
        const meeting = database.getMeetingById(meetingAnalyzeMatch[1]);
        if (!meeting) throw notFound('Meeting not found');
        const analysis = await analyzeMeeting({
          transcript: meeting.transcript,
          meetingTitle: meeting.title,
          provider: config.aiProvider,
          model: config.openaiModel,
          apiKey: config.openaiApiKey,
          geminiModel: config.geminiModel,
          geminiApiKey: config.geminiApiKey,
        });
        validateAnalysisResult(analysis, meeting.transcript);

        const normalizedActionItems = [];
        for (const item of analysis.actionItems || []) {
          const citations = item.citations ?? [];
          const sourceTimestamp = citations[0]?.timestamp;
          const citation = citations[0];
          normalizedActionItems.push(database.createActionItem({
            meetingId: meeting.id,
            task: assertString(item.task, 'analysis.actionItems.task'),
            assignee: assertOptionalString(item.assignee, 'analysis.actionItems.assignee'),
            status: 'PENDING',
            dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString(),
            sourceTimestamp,
            citations: citations.length ? citations : [citation],
          }));
        }
        const normalized = {
          ...analysis,
          actionItems: normalizedActionItems,
        };
        const updated = database.updateMeetingAnalysis(meeting.id, normalized);
        jsonResponse(res, 200, encodeResponse(traceId, true, updated.analysis), baseHeaders);
        return;
      }

      if (method === 'POST' && path === '/api/action-items') {
        const body = await readBody(req);
        const actionItem = database.createActionItem({
          meetingId: assertString(body.meetingId, 'meetingId'),
          task: assertString(body.task, 'task'),
          assignee: assertOptionalString(body.assignee, 'assignee'),
          status: body.status ? assertActionItemStatus(body.status) : 'PENDING',
          dueDate: assertIsoDateTime(body.dueDate, 'dueDate'),
          sourceTimestamp: assertOptionalString(body.sourceTimestamp, 'sourceTimestamp'),
          citations: assertArray(body.citations ?? [], 'citations'),
        });
        jsonResponse(res, 201, encodeResponse(traceId, true, actionItem), baseHeaders);
        return;
      }

      const actionItemStatusMatch = path.match(/^\/api\/action-items\/([^/]+)\/status$/);
      if (method === 'PATCH' && actionItemStatusMatch) {
        const body = await readBody(req);
        const actionItem = database.getActionItemById(actionItemStatusMatch[1]);
        if (!actionItem) throw notFound('Action item not found');
        const updated = database.updateActionItemStatus(actionItem.id, assertActionItemStatus(body.status));
        jsonResponse(res, 200, encodeResponse(traceId, true, updated), baseHeaders);
        return;
      }

      if (method === 'GET' && path === '/api/action-items') {
        const { page, limit } = buildPagination(Object.fromEntries(url.searchParams));
        const result = database.listActionItems({
          page,
          limit,
          status: url.searchParams.get('status') ? assertStatus(url.searchParams.get('status')) : undefined,
          assignee: assertOptionalString(url.searchParams.get('assignee'), 'assignee'),
          meetingId: assertOptionalString(url.searchParams.get('meetingId'), 'meetingId'),
        });
        jsonResponse(res, 200, encodeResponse(traceId, true, result), baseHeaders);
        return;
      }

      if (method === 'GET' && path === '/api/action-items/overdue') {
        const { page, limit } = buildPagination(Object.fromEntries(url.searchParams));
        const result = database.listActionItems({ page, limit, overdueOnly: true });
        jsonResponse(res, 200, encodeResponse(traceId, true, result), baseHeaders);
        return;
      }

      if (method === 'GET' && path === '/api/reminders') {
        const actionItemId = assertOptionalString(url.searchParams.get('actionItemId'), 'actionItemId');
        jsonResponse(res, 200, encodeResponse(traceId, true, { items: database.listReminderHistory(actionItemId) }), baseHeaders);
        return;
      }

      if (method === 'POST' && path === '/api/reminders/trigger') {
        await scheduler.runOnce();
        jsonResponse(res, 200, encodeResponse(traceId, true, { message: 'Sweep completed' }), baseHeaders);
        return;
      }

      throw notFound('Route not found');
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error('request_error', {
        traceId,
        method,
        path,
        statusCode: normalized.statusCode,
        error: normalized.message,
        details: normalized.details,
      });
      jsonResponse(
        res,
        normalized.statusCode,
        encodeResponse(traceId, false, {
          code: normalized.code,
          message: normalized.message,
          ...(normalized.details ? { details: normalized.details } : {}),
        }),
        baseHeaders,
      );
    } finally {
      logger.info('request_end', {
        traceId,
        method,
        path,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      });
    }
  }

  return { handler, database, logger, scheduler };
}

function authenticate(req, cfg) {
  const token = getBearerToken(req.headers.authorization);
  if (!token) throw unauthorized('Authorization header is required');
  return verifyAuthToken(token, cfg.authSecret);
}

export function createHttpServer(options = {}) {
  const app = createApp(options);
  const server = createServer(app.handler);
  return { server, ...app };
}
