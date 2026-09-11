/**
 * Telegram private chat IDs are numeric and never start with 0 (phone numbers do).
 * @returns {string|null}
 */
function normalizeTelegramChatId(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.startsWith('@')) return null;
  if (!/^-?\d{5,20}$/.test(s)) return null;
  if (/^0\d+$/.test(s)) return null;
  return s;
}

function telegramChatIdError(value) {
  if (value == null || String(value).trim() === '') {
    return 'This customer has not opened the RentFlow Telegram bot yet';
  }
  const s = String(value).trim();
  if (s.startsWith('@') || /^0\d+$/.test(s) || !/^-?\d{5,20}$/.test(s)) {
    return (
      'A phone number cannot receive Telegram bot messages. ' +
      'The customer must open the invite link once (or share phone in the bot) so we can message them.'
    );
  }
  return null;
}

function telegramBotUsername() {
  return String(process.env.TELEGRAM_BOT_USERNAME || 'RentTrackerApp_bot').replace(/^@/, '');
}

/** One-tap link: customer opens it → bot auto-links their chat to this customer. */
function customerTelegramInviteLink(customerId) {
  if (!customerId) return null;
  return `https://t.me/${telegramBotUsername()}?start=c_${customerId}`;
}

module.exports = {
  normalizeTelegramChatId,
  telegramChatIdError,
  telegramBotUsername,
  customerTelegramInviteLink,
};
