async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send message to Telegram
 * @param {string} message - The message text (Markdown supported)
 * @param {object} config - Configuration object
 * @param {string} config.botToken - Telegram Bot Token
 * @param {string} config.chatId - Telegram Chat ID
 * @param {boolean} [config.enabled=true] - Whether sending is enabled
 * @param {number} [config.timeoutMs=10000] - Request timeout
 * @param {number} [config.maxRetry=3] - Max retries
 */
async function sendTelegram(message, config = {}) {
  const {
    botToken,
    chatId,
    enabled = true,
    timeoutMs = 10000,
    maxRetry = 3
  } = config;

  if (!enabled) return;
  if (!botToken || !chatId) {
    console.log('[TG] disabled (missing TG_BOT_TOKEN/TG_CHAT_ID)');
    return;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown'
  };

  let attempt = 0;
  // Try once + maxRetry times
  const totalAttempts = maxRetry + 1;

  for (let i = 0; i < totalAttempts; i++) {
    attempt = i + 1;
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(id);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Status ${res.status}: ${text}`);
      }

      // Success
      return;

    } catch (err) {
      if (attempt >= totalAttempts) {
        console.error(`[TG] failed: ${err.message}`);
        return; // Give up
      }
      
      // Exponential backoff: 1s, 2s, 4s...
      const delay = Math.pow(2, attempt - 1) * 1000;
      await sleep(delay);
    }
  }
}

module.exports = { sendTelegram };
