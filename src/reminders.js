import { internal } from './errors.js';

export async function sendReminderWebhook({ actionItem, webhookUrl, webhookType, traceId }) {
  if (!webhookUrl) {
    return {
      provider: webhookType,
      deliveryStatus: 'SKIPPED_NO_WEBHOOK',
      responseText: 'REMINDER_WEBHOOK_URL is not configured',
    };
  }

  const payload = buildPayload(actionItem, webhookType);
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw internal(`Reminder webhook failed with status ${response.status}`, {
      traceId,
      responseText,
    });
  }

  return {
    provider: webhookType,
    deliveryStatus: 'SENT',
    responseText,
  };
}

function buildPayload(actionItem, webhookType) {
  const text = [
    'Reminder: ' + actionItem.task,
    `Assigned To: ${actionItem.assignee || 'Unassigned'}`,
    `Due Date: ${actionItem.dueDate}`,
    `Action Item ID: ${actionItem.id}`,
  ].join('\n');

  if (webhookType === 'slack' || webhookType === 'discord') {
    return { text };
  }

  if (webhookType === 'telegram') {
    return { text };
  }

  return {
    text,
    actionItem,
  };
}

export function createReminderScheduler({ database, config, logger }) {
  let timer = null;

  async function runOnce() {
    const overdue = database.listOverdueActionItems();
    for (const actionItem of overdue) {
      const history = database.listReminderHistory(actionItem.id);
      const lastAttempt = history[0];
      if (lastAttempt) {
        const lastAttemptTime = new Date(lastAttempt.sentAt).getTime();
        const throttleMs = 24 * 60 * 60 * 1000; // 24-hour throttle
        if (Date.now() - lastAttemptTime < throttleMs) {
          continue;
        }
      }

      const traceId = `reminder-${actionItem.id.slice(0, 8)}`;
      try {
        const result = await sendReminderWebhook({
          actionItem,
          webhookUrl: config.reminderWebhookUrl,
          webhookType: config.reminderWebhookType,
          traceId,
        });
        database.createReminderHistory({
          actionItemId: actionItem.id,
          sentAt: new Date().toISOString(),
          deliveryStatus: result.deliveryStatus,
          provider: result.provider,
          traceId,
          payload: {
            reminder: true,
            actionItemId: actionItem.id,
          },
          responseText: result.responseText,
        });
      } catch (error) {
        database.createReminderHistory({
          actionItemId: actionItem.id,
          sentAt: new Date().toISOString(),
          deliveryStatus: 'FAILED',
          provider: config.reminderWebhookType,
          traceId,
          payload: {
            reminder: true,
            actionItemId: actionItem.id,
          },
          responseText: error instanceof Error ? error.message : String(error),
        });
        logger.error('Reminder delivery failed', {
          traceId,
          actionItemId: actionItem.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  function start() {
    if (timer) return;
    runOnce().catch((error) => {
      logger.error('Initial reminder sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    timer = setInterval(runOnce, 60_000);
    timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { runOnce, start, stop };
}
