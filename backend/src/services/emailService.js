const nodemailer = require('nodemailer');
const fs = require('fs');

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function createTransport() {
  if (!smtpConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth:
      process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS || '',
          }
        : undefined,
  });
}

/**
 * Send settlement PDF by email. Returns { skipped } if SMTP is not configured.
 */
async function sendSettlementEmail({ to, customerName, subject, text, filePath }) {
  const transport = createTransport();
  if (!transport) {
    return { skipped: true, reason: 'Email is not configured (set SMTP_HOST and SMTP_FROM in .env)' };
  }
  if (!to) {
    return { skipped: true, reason: 'Customer has no email on file' };
  }

  const info = await transport.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: subject || 'RentFlow settlement slip',
    text:
      text ||
      `Hello ${customerName || ''},\n\nPlease find your RentFlow return settlement attached.\n\nThank you.`,
    attachments: filePath
      ? [
          {
            filename: 'rentflow-settlement.pdf',
            content: fs.createReadStream(filePath),
            contentType: 'application/pdf',
          },
        ]
      : [],
  });

  return { skipped: false, messageId: info.messageId };
}

module.exports = { sendSettlementEmail, smtpConfigured };
