import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { hashPassword } from './security.js';

export class Database {
  constructor(filename = config.databaseFile) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
    this.seedAdmin();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        meeting_date TEXT NOT NULL,
        participants_json TEXT NOT NULL,
        transcript_json TEXT NOT NULL,
        analysis_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_items (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        task TEXT NOT NULL,
        assignee TEXT,
        status TEXT NOT NULL,
        due_date TEXT NOT NULL,
        source_timestamp TEXT,
        citations_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS reminder_history (
        id TEXT PRIMARY KEY,
        action_item_id TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        delivery_status TEXT NOT NULL,
        provider TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        response_text TEXT,
        FOREIGN KEY (action_item_id) REFERENCES action_items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_meetings_meeting_date ON meetings(meeting_date);
      CREATE INDEX IF NOT EXISTS idx_action_items_status_due_date ON action_items(status, due_date);
      CREATE INDEX IF NOT EXISTS idx_action_items_meeting_id ON action_items(meeting_id);
    `);
  }

  seedAdmin() {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (count === 0) {
      const stmt = this.db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)');
      stmt.run(crypto.randomUUID(), config.adminEmail, hashPassword(config.adminPassword), new Date().toISOString());
    }
  }

  getUserByEmail(email) {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) || null;
  }

  createMeeting({ title, meetingDate, participants, transcript }) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO meetings (id, title, meeting_date, participants_json, transcript_json, analysis_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(id, title, meetingDate, JSON.stringify(participants), JSON.stringify(transcript), now, now);
    return this.getMeetingById(id);
  }

  updateMeetingAnalysis(id, analysis) {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE meetings SET analysis_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(analysis), now, id);
    return this.getMeetingById(id);
  }

  deleteMeeting(id) {
    this.db.prepare('DELETE FROM meetings WHERE id = ?').run(id);
  }

  getMeetingById(id) {
    const row = this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    return row ? this.inflateMeeting(row) : null;
  }

  listMeetings({ page, limit, title, participant, from, to }) {
    const clauses = [];
    const params = [];
    if (title) {
      clauses.push('LOWER(title) LIKE ?');
      params.push(`%${title.toLowerCase()}%`);
    }
    if (participant) {
      clauses.push('participants_json LIKE ?');
      params.push(`%${participant.toLowerCase()}%`);
    }
    if (from) {
      clauses.push('meeting_date >= ?');
      params.push(from);
    }
    if (to) {
      clauses.push('meeting_date <= ?');
      params.push(to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM meetings ${where}`).get(...params).count;
    const rows = this.db.prepare(`SELECT * FROM meetings ${where} ORDER BY meeting_date DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return {
      items: rows.map((row) => this.inflateMeeting(row)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  createActionItem(input) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO action_items (
        id, meeting_id, task, assignee, status, due_date, source_timestamp, citations_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.meetingId,
      input.task,
      input.assignee ?? null,
      input.status,
      input.dueDate,
      input.sourceTimestamp ?? null,
      JSON.stringify(input.citations ?? []),
      now,
      now,
    );
    return this.getActionItemById(id);
  }

  updateActionItemStatus(id, status) {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE action_items SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    return this.getActionItemById(id);
  }

  getActionItemById(id) {
    const row = this.db.prepare('SELECT * FROM action_items WHERE id = ?').get(id);
    return row ? this.inflateActionItem(row) : null;
  }

  listActionItems({ page, limit, status, assignee, meetingId, overdueOnly = false }) {
    const clauses = [];
    const params = [];
    if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (assignee) {
      clauses.push('LOWER(COALESCE(assignee, \'\')) = ?');
      params.push(assignee.toLowerCase());
    }
    if (meetingId) {
      clauses.push('meeting_id = ?');
      params.push(meetingId);
    }
    if (overdueOnly) {
      clauses.push("status != 'COMPLETED' AND due_date < ?");
      params.push(new Date().toISOString());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM action_items ${where}`).get(...params).count;
    const rows = this.db.prepare(`SELECT * FROM action_items ${where} ORDER BY due_date ASC, created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return {
      items: rows.map((row) => this.inflateActionItem(row)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  listOverdueActionItems() {
    return this.listActionItems({ page: 1, limit: 1000, overdueOnly: true }).items;
  }

  createReminderHistory(entry) {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO reminder_history (
        id, action_item_id, sent_at, delivery_status, provider, trace_id, payload_json, response_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.actionItemId,
      entry.sentAt,
      entry.deliveryStatus,
      entry.provider,
      entry.traceId,
      JSON.stringify(entry.payload),
      entry.responseText ?? null,
    );
  }

  listReminderHistory(actionItemId = null) {
    const rows = actionItemId
      ? this.db.prepare('SELECT * FROM reminder_history WHERE action_item_id = ? ORDER BY sent_at DESC').all(actionItemId)
      : this.db.prepare('SELECT * FROM reminder_history ORDER BY sent_at DESC').all();
    return rows.map((row) => ({
      id: row.id,
      actionItemId: row.action_item_id,
      sentAt: row.sent_at,
      deliveryStatus: row.delivery_status,
      provider: row.provider,
      traceId: row.trace_id,
      payload: JSON.parse(row.payload_json),
      responseText: row.response_text,
    }));
  }

  inflateMeeting(row) {
    return {
      id: row.id,
      title: row.title,
      meetingDate: row.meeting_date,
      participants: JSON.parse(row.participants_json),
      transcript: JSON.parse(row.transcript_json),
      analysis: row.analysis_json ? JSON.parse(row.analysis_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  inflateActionItem(row) {
    return {
      id: row.id,
      meetingId: row.meeting_id,
      task: row.task,
      assignee: row.assignee,
      status: row.status,
      dueDate: row.due_date,
      sourceTimestamp: row.source_timestamp,
      citations: JSON.parse(row.citations_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
