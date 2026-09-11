const path = require('path');
const { Api } = require('node-telegram-bot-api');
const { fromPath } = require('node-telegram-bot-api/node');

let api = null;

function getApi() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  if (!api) {
    api = new Api(token);
  }
  return api;
}

/** @deprecated use getApi — kept for callers that expect getBot() */
function getBot() {
  return getApi();
}

async function sendMessage(chatId, text, options = {}) {
  const client = getApi();
  if (!client || !chatId) {
    console.warn('Telegram skipped: missing bot token or chat id');
    return { skipped: true };
  }
  return client.sendMessage({
    chat_id: chatId,
    text,
    parse_mode: options.parse_mode || 'HTML',
    ...options,
  });
}

async function sendDocument(chatId, filePath, caption) {
  const client = getApi();
  if (!client || !chatId) {
    console.warn('Telegram document skipped: missing bot token or chat id');
    return { skipped: true };
  }
  const document = await fromPath(filePath, {
    filename: path.basename(filePath),
  });
  return client.sendDocument({
    chat_id: chatId,
    document,
    caption: caption || undefined,
  });
}

async function notifyManagers(text) {
  const chatId = process.env.TELEGRAM_MANAGER_CHAT_ID;
  return sendMessage(chatId, text);
}

module.exports = { sendMessage, sendDocument, notifyManagers, getBot, getApi };
