import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export const config = {
  rootDir: projectRoot,
  port: Number(env('PORT', '3000')),
  databaseFile: path.resolve(projectRoot, env('DATABASE_FILE', './data/app.db')),
  adminEmail: env('ADMIN_EMAIL', 'admin@example.com').toLowerCase(),
  adminPassword: env('ADMIN_PASSWORD', 'change-me'),
  authSecret: env('AUTH_SECRET', 'super-secret-change-me'),
  aiProvider: env('AI_PROVIDER', 'auto'),
  openaiApiKey: env('OPENAI_API_KEY', ''),
  openaiModel: env('OPENAI_MODEL', 'gpt-4.1-mini'),
  geminiApiKey: env('GEMINI_API_KEY', ''),
  geminiModel: env('GEMINI_MODEL', 'gemini-2.5-flash'),
  reminderWebhookUrl: env('REMINDER_WEBHOOK_URL', ''),
  reminderWebhookType: env('REMINDER_WEBHOOK_TYPE', 'slack'),
  rateLimitWindowMs: Number(env('RATE_LIMIT_WINDOW_MS', '60000')),
  rateLimitMaxRequests: Number(env('RATE_LIMIT_MAX_REQUESTS', '120')),
  candidateName: env('CANDIDATE_NAME', 'Demo Candidate'),
  repositoryUrl: env('REPOSITORY_URL', 'https://github.com/example/project'),
  deployedUrl: env('DEPLOYED_URL', 'http://localhost:3000'),
};
