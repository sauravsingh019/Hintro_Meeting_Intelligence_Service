import { badRequest, internal } from './errors.js';

function normalizeTranscript(transcript) {
  return transcript.map((item) => ({
    timestamp: item.timestamp,
    speaker: item.speaker,
    text: item.text,
  }));
}

function citationFor(entry) {
  return [{ timestamp: entry.timestamp }];
}

function uniq(items) {
  return [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
}

function sentenceList(transcript) {
  return transcript.map((entry) => `${entry.speaker}: ${entry.text}`);
}

function extractTasks(transcript) {
  const items = [];
  for (const entry of transcript) {
    const text = entry.text.trim();
    const lower = text.toLowerCase();
    if (/\b(i will|i'll|we will|we'll|we should|please|let's|need to|needs to|can you|could you)\b/.test(lower)) {
      let task = text;
      task = task.replace(/^[^.]*?\b(i will|i'll|we will|we'll|we should|please|let's|need to|needs to|can you|could you)\b[:\s-]*/i, '');
      task = task.replace(/\.$/, '');
      items.push({
        task: task || text,
        assignee: entry.speaker,
        citations: citationFor(entry),
        sourceTimestamp: entry.timestamp,
      });
    }
  }
  return uniq(items);
}

function extractDecisions(transcript) {
  const items = [];
  for (const entry of transcript) {
    if (/\b(decid|agreed|confirmed|approved|we're going with|we will go with|we'll go with|decided)\b/i.test(entry.text)) {
      items.push({
        text: entry.text.replace(/\s+/g, ' ').trim(),
        citations: citationFor(entry),
      });
    }
  }
  return uniq(items);
}

function extractFollowUps(actionItems, transcript) {
  if (!actionItems.length) {
    return transcript.slice(0, 1).map((entry) => ({
      text: `Continue the conversation around: ${entry.text}`,
      citations: citationFor(entry),
    }));
  }
  return actionItems.map((item) => ({
    text: `Follow up on ${item.task}.`,
    citations: item.citations,
  }));
}

function summaryFromTranscript(transcript) {
  const entries = transcript.slice(0, 3);
  return entries.map((entry) => ({
    text: `${entry.speaker} said: ${entry.text}`,
    citations: citationFor(entry),
  }));
}

function fallbackAnalysis(transcript, meetingTitle) {
  const normalized = normalizeTranscript(transcript);
  const actionItems = extractTasks(normalized);
  const decisions = extractDecisions(normalized);
  const summary = summaryFromTranscript(normalized);
  const followUpSuggestions = extractFollowUps(actionItems, normalized);
  return {
    meetingTitle,
    summary,
    actionItems,
    decisions,
    followUpSuggestions,
    provider: 'fallback',
  };
}

async function callGemini(transcript, meetingTitle, model, apiKey) {
  const systemInstruction = 'You are a meeting analysis engine. Return strict JSON only matching the schema. Ground every claim in the transcript. Do not invent attendees, outcomes, or action items.';
  
  const userPrompt = JSON.stringify({
    meetingTitle,
    transcript,
    outputSchema: {
      summary: [{ text: 'string', citations: [{ timestamp: 'string' }] }],
      actionItems: [{ task: 'string', assignee: 'string|null', citations: [{ timestamp: 'string' }] }],
      decisions: [{ text: 'string', citations: [{ timestamp: 'string' }] }],
      followUpSuggestions: [{ text: 'string', citations: [{ timestamp: 'string' }] }],
    },
  });

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: userPrompt }]
      }],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    throw internal(`Gemini request failed with status ${response.status}`);
  }
  const json = await response.json();
  const content = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw internal('Gemini response was empty');
  const parsed = JSON.parse(content);
  return {
    meetingTitle,
    provider: 'gemini',
    summary: parsed.summary ?? [],
    actionItems: parsed.actionItems ?? [],
    decisions: parsed.decisions ?? [],
    followUpSuggestions: parsed.followUpSuggestions ?? [],
  };
}

async function callOpenAI(transcript, meetingTitle, model, apiKey) {
  const messages = [
    {
      role: 'system',
      content: 'You are a meeting analysis engine. Return strict JSON only. Ground every claim in the transcript. Do not invent attendees, outcomes, or action items.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        meetingTitle,
        transcript,
        outputSchema: {
          summary: [{ text: 'string', citations: [{ timestamp: 'string' }] }],
          actionItems: [{ task: 'string', assignee: 'string|null', citations: [{ timestamp: 'string' }] }],
          decisions: [{ text: 'string', citations: [{ timestamp: 'string' }] }],
          followUpSuggestions: [{ text: 'string', citations: [{ timestamp: 'string' }] }],
        },
      }),
    },
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw internal(`OpenAI request failed with status ${response.status}`);
  }
  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw internal('OpenAI response was empty');
  const parsed = JSON.parse(content);
  return {
    meetingTitle,
    provider: 'openai',
    summary: parsed.summary ?? [],
    actionItems: parsed.actionItems ?? [],
    decisions: parsed.decisions ?? [],
    followUpSuggestions: parsed.followUpSuggestions ?? [],
  };
}

export async function analyzeMeeting({ transcript, meetingTitle, provider, model, apiKey, geminiModel, geminiApiKey }) {
  if (!Array.isArray(transcript) || !transcript.length) {
    throw badRequest('Transcript is required for analysis');
  }

  if (provider === 'gemini' || (provider === 'auto' && geminiApiKey)) {
    try {
      const result = await callGemini(transcript, meetingTitle, geminiModel || 'gemini-2.5-flash', geminiApiKey);
      if (result.summary.length || result.actionItems.length || result.decisions.length) {
        return result;
      }
    } catch (error) {
      console.error('Gemini analysis failed, falling back:', error);
    }
  }

  if (provider === 'openai' || (provider === 'auto' && apiKey)) {
    try {
      const result = await callOpenAI(transcript, meetingTitle, model, apiKey);
      if (result.summary.length || result.actionItems.length || result.decisions.length) {
        return result;
      }
    } catch (error) {
      console.error('OpenAI analysis failed, falling back:', error);
    }
  }

  return fallbackAnalysis(transcript, meetingTitle);
}

export function validateAnalysisResult(analysis, transcript) {
  const timestamps = new Set(transcript.map((entry) => entry.timestamp));
  const arrays = ['summary', 'actionItems', 'decisions', 'followUpSuggestions'];
  for (const key of arrays) {
    if (!Array.isArray(analysis[key])) throw badRequest(`analysis.${key} must be an array`);
    for (const item of analysis[key]) {
      if (!item || typeof item !== 'object') throw badRequest(`analysis.${key} items must be objects`);
      if (typeof item.text !== 'string' && typeof item.task !== 'string') {
        throw badRequest(`analysis.${key} item must contain text or task`);
      }
      if (!Array.isArray(item.citations) || item.citations.length === 0) {
        throw badRequest(`analysis.${key} items must include citations`);
      }
      for (const citation of item.citations) {
        if (!citation || typeof citation.timestamp !== 'string' || !timestamps.has(citation.timestamp)) {
          throw badRequest(`analysis citations must reference timestamps from the transcript`);
        }
      }
    }
  }
  return analysis;
}
