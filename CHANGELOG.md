# Changelog

## 1.0.0

- Built the full meeting intelligence backend
- Added auth, meetings, action items, analysis, reminders, and evaluation endpoints
- Added OpenAPI docs and a public docs page
- Added structured logging, trace IDs, validation, and unified responses
- Added SQLite persistence and reminder history
- Added tests for core flows

## 1.1.0

- Added Gemini API as a first-class AI provider with custom JSON schema and grounding.
- Implemented reminder throttling (24-hour rate limit per action item) to prevent webhook spamming and database bloat.
- Added Meeting Deletion capability (DELETE `/api/meetings/:id`) with SQLite foreign key cascading deletes (auto-cleans action items and reminder logs).
- Added a fullstack, glassmorphic Single-Page Application (SPA) dashboard served at the root route for end-to-end evaluation.
- Added comprehensive unit tests for the reminder scheduler, webhook execution, throttling, meeting deletion, and Gemini mock parsing.
- Updated project documentation (checklist, decisions, testing, and AI approach).
