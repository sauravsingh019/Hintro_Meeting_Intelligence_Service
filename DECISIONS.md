# Technical Decisions

## Database: SQLite

**Why**
- Built into the bundled Node 24 runtime through `node:sqlite`
- Lightweight, reliable, and easy to ship in a single-project assignment
- Supports persistent relational storage without extra services

**Alternatives considered**
- PostgreSQL
- MySQL
- MongoDB

**Trade-offs**
- SQLite is simpler for local development and evaluation
- It is less suited for highly concurrent production workloads than a managed database

## Authentication: Bearer Tokens

**Why**
- Easy to use for protected APIs
- Keeps the API stateless
- Simple to test and document

**Alternatives considered**
- Session cookies
- Full OAuth flow

**Trade-offs**
- Bearer tokens are less user-friendly for browser sessions than cookies
- Sessions would need extra server-side state

## AI Strategy: Multi-Provider + Grounded Fallback

**Why**
- The assignment allows any LLM provider, so we support Gemini (using the native `fetch` API for `gemini-2.5-flash`) and OpenAI as first-class providers.
- Dynamic fallback checks the provider parameter and fallback order: Gemini -> OpenAI -> Deterministic Heuristic Fallback.
- The deterministic fallback ensures that the application remains fully functional and verified even when external keys are not configured.

**Alternatives considered**
- Hard dependency on a single LLM provider.
- Restricting integration to only OpenAI.

**Trade-offs**
- The fallback is deterministic but less natural than a live model.
- Multi-provider support adds environment variables (`GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENAI_API_KEY`, etc.) but provides maximum flexibility.

## Reminder Integration: Webhook

**Why**
- Slack/Discord/Telegram webhooks are real third-party integrations.
- Easy to invoke from the reminder workflow.
- Straightforward to validate in a deployment.

**Alternatives considered**
- Email API
- Calendar API

**Trade-offs**
- Webhooks are simpler than full account-based integrations.
- Delivery success depends on external webhook configuration.

## Reminder Throttling (Spam Prevention)

**Why**
- In a production context, checking overdue tasks every 60 seconds would spam the third-party integrations.
- We implement a 24-hour rate limit on overdue notifications for each action item.
- We check the database's `reminder_history` table and skip notifying if a reminder attempt (whether sent, skipped, or failed) was made within the last 24 hours.

**Alternatives considered**
- No throttling (would spam webhook channels every minute).
- Checking in-memory cache instead of database (risk of losing state on server restart).

**Trade-offs**
- 24-hour throttling is fixed, but could be made configurable in the future.
- If a user configures a new webhook URL, they must wait or trigger manually if a reminder was already throttled.

## Project Structure

**Why**
- Split into focused modules: DB, auth, AI, reminders, validation, and HTTP routing
- Keeps logic testable and easier to extend

**Alternatives considered**
- One large server file

**Trade-offs**
- More files to navigate
- Better maintainability and clearer responsibilities
