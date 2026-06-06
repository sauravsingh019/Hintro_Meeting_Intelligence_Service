import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../src/db.js';
import { createHttpServer } from '../src/app.js';
import { config } from '../src/config.js';
import { createReminderScheduler } from '../src/reminders.js';
import { analyzeMeeting } from '../src/ai.js';

function tempDbFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hintro-db-'));
  return path.join(dir, 'app.db');
}

async function startTestServer(database) {
  const { server } = createHttpServer({ database, startScheduler: false });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, port };
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.adminEmail, password: config.adminPassword }),
  });
  assert.equal(response.status, 200);
  const json = await response.json();
  return json.data.token;
}

test('health endpoint works', async () => {
  const database = new Database(tempDbFile());
  const { server, port } = await startTestServer(database);
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  assert.equal(json.data.status, 'UP');
  server.close();
});

test('auth, meeting creation, analysis, and action item flow works', async () => {
  const database = new Database(tempDbFile());
  const { server, port } = await startTestServer(database);
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = await login(baseUrl);

  const createMeeting = await fetch(`${baseUrl}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Sprint Planning',
      participants: ['alice@example.com', 'bob@example.com'],
      meetingDate: '2026-05-20T10:00:00Z',
      transcript: [
        { timestamp: '00:10', speaker: 'John', text: 'We should launch next Friday.' },
        { timestamp: '00:20', speaker: 'Alice', text: 'I will prepare release notes.' },
      ],
    }),
  });
  assert.equal(createMeeting.status, 201);
  const meeting = (await createMeeting.json()).data;

  const analysisResponse = await fetch(`${baseUrl}/api/meetings/${meeting.id}/analyze`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(analysisResponse.status, 200);
  const analysis = (await analysisResponse.json()).data;
  assert.ok(Array.isArray(analysis.summary));
  assert.ok(analysis.summary[0].citations[0].timestamp);

  const itemsResponse = await fetch(`${baseUrl}/api/action-items?meetingId=${meeting.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(itemsResponse.status, 200);
  const items = (await itemsResponse.json()).data.items;
  assert.ok(items.length >= 1);

  server.close();
});

test('evaluation endpoint is public', async () => {
  const database = new Database(tempDbFile());
  const { server, port } = await startTestServer(database);
  const response = await fetch(`http://127.0.0.1:${port}/api/evaluation`);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.success, true);
  assert.ok(json.data.features.includes('Authentication'));
  server.close();
});

test('overdue action items are detected', async () => {
  const database = new Database(tempDbFile());
  const { server, port } = await startTestServer(database);
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = await login(baseUrl);

  const meetingResponse = await fetch(`${baseUrl}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Review',
      participants: ['alice@example.com'],
      meetingDate: '2026-05-20T10:00:00Z',
      transcript: [
        { timestamp: '00:10', speaker: 'Alice', text: 'We should follow up on the budget.' },
      ],
    }),
  });
  const meeting = (await meetingResponse.json()).data;

  await fetch(`${baseUrl}/api/action-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      meetingId: meeting.id,
      task: 'Prepare budget review',
      assignee: 'alice@example.com',
      dueDate: '2000-01-01T00:00:00Z',
      citations: [{ timestamp: '00:10' }],
    }),
  });

  const overdueResponse = await fetch(`${baseUrl}/api/action-items/overdue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(overdueResponse.status, 200);
  const overdue = (await overdueResponse.json()).data.items;
  assert.ok(overdue.length >= 1);
  server.close();
});

test('reminder scheduler skips when webhook is not configured', async () => {
  const database = new Database(tempDbFile());
  const meeting = database.createMeeting({
    title: 'No Webhook Test',
    meetingDate: '2026-05-20T10:00:00Z',
    participants: ['alice@example.com'],
    transcript: [{ timestamp: '00:10', speaker: 'Alice', text: 'Task description.' }],
  });

  const actionItem = database.createActionItem({
    meetingId: meeting.id,
    task: 'Do task',
    assignee: 'Alice',
    status: 'PENDING',
    dueDate: '2000-01-01T00:00:00Z',
    citations: [{ timestamp: '00:10' }],
  });

  const scheduler = createReminderScheduler({
    database,
    config: { reminderWebhookUrl: '', reminderWebhookType: 'slack' },
    logger: { error: () => {}, info: () => {}, warn: () => {} },
  });

  await scheduler.runOnce();

  const history = database.listReminderHistory(actionItem.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].deliveryStatus, 'SKIPPED_NO_WEBHOOK');
});

test('reminder scheduler sends webhook when URL is configured', async () => {
  const database = new Database(tempDbFile());
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  let fetchBody = null;

  globalThis.fetch = async (url, options) => {
    fetchCalled = true;
    fetchBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => 'ok',
    };
  };

  try {
    const meeting = database.createMeeting({
      title: 'Reminder Webhook Test',
      meetingDate: '2026-05-20T10:00:00Z',
      participants: ['alice@example.com'],
      transcript: [{ timestamp: '00:10', speaker: 'Alice', text: 'Need to prepare notes.' }],
    });

    const actionItem = database.createActionItem({
      meetingId: meeting.id,
      task: 'Prepare notes',
      assignee: 'Alice',
      status: 'PENDING',
      dueDate: '2000-01-01T00:00:00Z',
      citations: [{ timestamp: '00:10' }],
    });

    const scheduler = createReminderScheduler({
      database,
      config: { reminderWebhookUrl: 'https://example.com/webhook', reminderWebhookType: 'slack' },
      logger: { error: () => {}, info: () => {}, warn: () => {} },
    });

    await scheduler.runOnce();

    assert.ok(fetchCalled);
    assert.match(fetchBody.text, /Reminder: Prepare notes/);

    const history = database.listReminderHistory(actionItem.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].deliveryStatus, 'SENT');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reminder scheduler throttles duplicate attempts within 24 hours', async () => {
  const database = new Database(tempDbFile());
  const meeting = database.createMeeting({
    title: 'Throttle Test',
    meetingDate: '2026-05-20T10:00:00Z',
    participants: ['alice@example.com'],
    transcript: [{ timestamp: '00:10', speaker: 'Alice', text: 'Finish project.' }],
  });

  const actionItem = database.createActionItem({
    meetingId: meeting.id,
    task: 'Finish project',
    assignee: 'Alice',
    status: 'PENDING',
    dueDate: '2000-01-01T00:00:00Z',
    citations: [{ timestamp: '00:10' }],
  });

  const scheduler = createReminderScheduler({
    database,
    config: { reminderWebhookUrl: '', reminderWebhookType: 'slack' },
    logger: { error: () => {}, info: () => {}, warn: () => {} },
  });

  // First run: should execute and record a skipped history entry
  await scheduler.runOnce();
  let history = database.listReminderHistory(actionItem.id);
  assert.equal(history.length, 1);

  // Second run: should be throttled (no new history entry written)
  await scheduler.runOnce();
  history = database.listReminderHistory(actionItem.id);
  assert.equal(history.length, 1);
});

test('Gemini analysis works with mocked response', async () => {
  const originalFetch = globalThis.fetch;
  let geminiApiCalled = false;
  let geminiBody = null;

  const mockResponse = {
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            summary: [{ text: 'Grounded summary of meeting', citations: [{ timestamp: '00:10' }] }],
            actionItems: [{ task: 'Prepare slide deck', assignee: 'Bob', citations: [{ timestamp: '00:20' }] }],
            decisions: [{ text: 'Launch next month', citations: [{ timestamp: '00:10' }] }],
            followUpSuggestions: [{ text: 'Review slides', citations: [{ timestamp: '00:20' }] }]
          })
        }]
      }
    }]
  };

  globalThis.fetch = async (url, options) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiApiCalled = true;
      geminiBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => mockResponse,
      };
    }
    return originalFetch(url, options);
  };

  try {
    const transcript = [
      { timestamp: '00:10', speaker: 'Alice', text: 'Let us launch next month.' },
      { timestamp: '00:20', speaker: 'Bob', text: 'I will prepare the slide deck.' }
    ];

    const result = await analyzeMeeting({
      transcript,
      meetingTitle: 'Mock Project Review',
      provider: 'gemini',
      geminiModel: 'gemini-2.5-flash',
      geminiApiKey: 'mock-gemini-key',
    });

    assert.ok(geminiApiCalled);
    assert.equal(result.provider, 'gemini');
    assert.equal(result.summary[0].text, 'Grounded summary of meeting');
    assert.equal(result.actionItems[0].task, 'Prepare slide deck');
    assert.equal(result.actionItems[0].assignee, 'Bob');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dashboard home page loads successfully', async () => {
  const database = new Database(tempDbFile());
  const { server, port } = await startTestServer(database);
  const response = await fetch(`http://127.0.0.1:${port}/`);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /Hintro Meeting Intelligence Dashboard/);
  server.close();
});

test('trigger reminders endpoint works', async () => {
  const database = new Database(tempDbFile());
  const { server, port } = await startTestServer(database);
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = await login(baseUrl);

  const response = await fetch(`${baseUrl}/api/reminders/trigger`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  server.close();
});

test('deleting a meeting cascade deletes its action items', async () => {
  const database = new Database(tempDbFile());
  const { server, port } = await startTestServer(database);
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = await login(baseUrl);

  // 1. Create a meeting
  const meetRes = await fetch(`${baseUrl}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Deletion Test',
      meetingDate: '2026-05-20T10:00:00Z',
      participants: ['alice@example.com'],
      transcript: [{ timestamp: '00:10', speaker: 'Alice', text: 'Task description.' }]
    })
  });
  const meeting = (await meetRes.json()).data;

  // 2. Create an action item for this meeting
  const actRes = await fetch(`${baseUrl}/api/action-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      meetingId: meeting.id,
      task: 'Cascade task',
      assignee: 'alice@example.com',
      dueDate: '2026-05-25T00:00:00Z',
      citations: [{ timestamp: '00:10' }]
    })
  });
  const actionItem = (await actRes.json()).data;

  // Verify it exists in DB
  assert.ok(database.getActionItemById(actionItem.id));

  // 3. Delete the meeting
  const delRes = await fetch(`${baseUrl}/api/meetings/${meeting.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(delRes.status, 200);

  // Verify meeting is deleted
  assert.equal(database.getMeetingById(meeting.id), null);

  // Verify action item is cascadingly deleted
  assert.equal(database.getActionItemById(actionItem.id), null);

  server.close();
});
