# Hintro Meeting Intelligence Service

A complete backend and fullstack application for the Hintro assignment. It includes:

- **Interactive Frontend SPA Dashboard** at the root path (`http://localhost:3000/`) built with premium dark-mode aesthetics and glassmorphism.
- Bearer-token authentication (login portal embedded in the UI).
- Meeting CRUD with dynamic transcript segment input builders.
- AI-powered meeting analysis (Gemini and OpenAI support) with interactive transcript-grounded citation highlights.
- Action-item tracking, status toggling, and overdue detection.
- Scheduled reminder delivery via a third-party webhook (Slack/Discord/Telegram) with 24-hour rate limit throttling to avoid spam.
- Unified response format, trace IDs, validation, and structured logs.
- OpenAPI JSON contract, static docs page, and robust test coverage.

## Tech Stack

- Node.js 24+
- Built-in `node:http`
- Built-in `node:sqlite`
- No external npm dependencies

## Quick Start

```bash
cp .env.example .env
node src/server.js
```

Default server URL: `http://localhost:3000`

## Environment Variables

- `PORT` - server port
- `DATABASE_FILE` - SQLite database file path
- `ADMIN_EMAIL` - seeded admin login email
- `ADMIN_PASSWORD` - seeded admin login password
- `AUTH_SECRET` - HMAC secret for auth tokens
- `AI_PROVIDER` - `auto` or `openai`
- `OPENAI_API_KEY` - optional OpenAI API key
- `OPENAI_MODEL` - OpenAI model name
- `REMINDER_WEBHOOK_URL` - Slack/Discord/Telegram/email webhook target
- `REMINDER_WEBHOOK_TYPE` - `slack`, `discord`, `telegram`, or `generic`
- `RATE_LIMIT_WINDOW_MS` - rate limiting window
- `RATE_LIMIT_MAX_REQUESTS` - max requests per IP per window
- `CANDIDATE_NAME` - name returned by the evaluation endpoint
- `REPOSITORY_URL` - repository URL returned by the evaluation endpoint
- `DEPLOYED_URL` - deployed URL returned by the evaluation endpoint

## Authentication

Login with the configured admin credentials:
- **Local Dev Default**: Email: `admin@example.com`, Password: `change-me`
- **Live Deployment**: Email: `<ADMIN_EMAIL from environment variables>` (e.g., your email `skbhadana019@gmail.com`), Password: `<ADMIN_PASSWORD from environment variables>`

```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "change-me"
}
```


Use the returned token as:

```bash
Authorization: Bearer <token>
```

## Main Endpoints

- `GET /health`
- `GET /docs`
- `GET /openapi.json`
- `GET /api/evaluation`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/meetings`
- `GET /api/meetings`
- `GET /api/meetings/:id`
- `POST /api/meetings/:id/analyze`
- `POST /api/action-items`
- `PATCH /api/action-items/:id/status`
- `GET /api/action-items`
- `GET /api/action-items/overdue`
- `GET /api/reminders`

## Example: Create Meeting

```bash
curl -X POST http://localhost:3000/api/meetings \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Sprint Planning",
    "participants": ["alice@example.com", "bob@example.com"],
    "meetingDate": "2026-05-20T10:00:00Z",
    "transcript": [
      { "timestamp": "00:10", "speaker": "John", "text": "We should launch next Friday." },
      { "timestamp": "00:20", "speaker": "Alice", "text": "I will prepare release notes." }
    ]
  }'
```

## Example: Analyze Meeting

```bash
curl -X POST http://localhost:3000/api/meetings/<id>/analyze \
  -H "Authorization: Bearer <token>"
```

## Response Format

All APIs return:

```json
{
  "traceId": "abc123",
  "success": true,
  "data": {}
}
```

Errors follow:

```json
{
  "traceId": "abc123",
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Meeting title is required"
  }
}
```

## Deployment

1. Set the environment variables above.
2. Run the app with `node src/server.js`.
3. Expose port `PORT` publicly.
4. Point your webhook integration at a real Slack/Discord/Telegram endpoint.

Suggested platforms: Render, Railway, Fly.io, or Vercel-compatible backend hosting.

## Tests

```bash
node --test
```

## Project Notes

- AI analysis uses OpenAI when `OPENAI_API_KEY` is present.
- If no LLM is configured, the project falls back to a deterministic grounded analyzer.
- Reminder delivery uses the configured webhook in the reminder workflow and writes reminder history into SQLite.
