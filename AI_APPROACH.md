# AI Approach

## Prompt Design

The meeting analysis route builds a structured prompt that asks the model to return JSON matching a specific schema. 

For **Gemini** (defaulting to `gemini-2.5-flash`), we use the native JSON Schema support via `responseMimeType: "application/json"`. The prompt and configuration:
- Supply the system instructions via `systemInstruction` to keep the model grounded.
- Forbid inventing attendees, outcomes, or action items.
- Request a structured payload containing: `summary`, `actionItems`, `decisions`, and `followUpSuggestions`.
- Enforce citation timestamps that correspond to exact segments in the transcript.

For **OpenAI** (defaulting to `gpt-4.1-mini`), we use `response_format: { type: "json_object" }` with an identical prompt structure.

## Citation Strategy

Each generated item must include at least one citation object with a transcript timestamp. The app validates that every citation points to a timestamp that exists in the original transcript before storing the result.

## Hallucination Prevention

Three layers reduce unsupported output:

1. System instructions and prompts explicitly direct the model to ground all responses in the provided transcript segments.
2. The validation layer rejects any items missing citations or referencing unknown/hallucinated timestamps.
3. If the active provider fails, returns invalid JSON, or triggers a schema violation, the analyzer falls back gracefully: **Gemini -> OpenAI -> Heuristic Deterministic Fallback**.

## Output Validation

The app checks:

- Required arrays exist
- Every item has text or task content
- Every item has citations
- Every citation references a real transcript timestamp

## Known Limitations

- The fallback analyzer is heuristic-based and less nuanced than a strong hosted model
- Action-item due dates are inferred during analysis unless a client supplies explicit action items
- Model quality depends on the configured provider and prompt compliance
