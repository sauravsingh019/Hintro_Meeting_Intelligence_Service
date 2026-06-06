# Testing

## Scenarios Executed

- Health endpoint returns `UP`
- Login succeeds with seeded admin credentials
- Meeting creation stores transcript data
- Meeting analysis returns grounded citations
- Action items can be listed after analysis
- Public evaluation endpoint returns the expected payload
- Reminder scheduler logs skip entries when webhook URL is not configured
- Reminder scheduler successfully fires webhooks with customized payload when URL is configured
- Reminder scheduler throttles duplicate overdue reminders within 24 hours to prevent spam
- Gemini analysis functions correctly under mock fetch interceptor

## Edge Cases Considered

- Missing or malformed JSON
- Invalid emails
- Invalid timestamps and dates
- Missing authentication header
- Invalid action-item status values
- Empty transcripts
- Unknown meeting/action-item IDs
- Rate limiting responses
- Duplicate reminder spamming prevention (24-hour rate limit)
- Mock API error/fallback scenarios for LLMs

## Limitations Discovered

- The reminder workflow is only as real as the configured webhook URL
- SQLite is ideal for this assignment but not a drop-in replacement for heavy multi-node production traffic
- The fallback analyzer is deterministic, so it is less expressive than a live LLM
