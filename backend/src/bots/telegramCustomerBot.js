const fs = require('fs');
const path = require('path');
const { Bot } = require('node-telegram-bot-api');
const { query } = require('../config/db');
const { getApi, sendMessage, sendDocument, notifyManagers } = require('../services/telegramService');
const { normalizeTelegramChatId } = require('../utils/telegram');

/** In-memory intake sessions: chatId → { fileRelative, amount?, reference?, step } */
const sessions = new Map();

async function findCustomerByChatId(chatId) {
  const id = String(chatId);
  const { rows } = await query(
    `SELECT * FROM customers
     WHERE is_deleted = FALSE AND telegram_chat_id = $1
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Open access: anyone who /start is linked immediately (create customer if needed).
 * No invite code, phone share, or pre-registration required.
 */
async function ensureCustomerFromTelegram(ctx) {
  const chatId = ctx.chatId ?? ctx.chat?.id ?? ctx.message?.chat?.id;
  if (!chatId) return null;

  const existing = await findCustomerByChatId(chatId);
  if (existing) return existing;

  const from = ctx.from || ctx.message?.from || {};
  const nameParts = [from.first_name, from.last_name].filter(Boolean);
  const fullName =
    nameParts.join(' ').trim() ||
    (from.username ? `@${from.username}` : `Telegram ${chatId}`);

  const { rows } = await query(
    `INSERT INTO customers (full_name, phone, address, notes, telegram_chat_id)
     VALUES ($1, NULL, '', $2, $3)
     RETURNING *`,
    [
      fullName,
      `Auto-linked via Telegram /start` +
        (from.username ? ` (@${from.username})` : ''),
      String(chatId),
    ]
  );
  return rows[0];
}

async function linkCustomerChat(customerId, chatId) {
  await query(`UPDATE customers SET telegram_chat_id = $1 WHERE id = $2`, [
    String(chatId),
    customerId,
  ]);
}

async function findActiveBooking(customerId) {
  const { rows } = await query(
    `SELECT * FROM bookings
     WHERE customer_id = $1
       AND status IN ('confirmed', 'out_for_rent', 'overdue', 'returned')
     ORDER BY
       CASE status
         WHEN 'out_for_rent' THEN 1
         WHEN 'overdue' THEN 2
         WHEN 'confirmed' THEN 3
         WHEN 'returned' THEN 4
         ELSE 5
       END,
       created_at DESC
     LIMIT 1`,
    [customerId]
  );
  return rows[0] || null;
}

function ensureReceiptsDir() {
  const dir = path.join(__dirname, '../../uploads/receipts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function downloadTelegramFile(fileId, preferredName) {
  const api = getApi();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const file = await api.getFile({ file_id: fileId });
  if (!file?.file_path) throw new Error('Telegram file path missing');

  const ext = path.extname(file.file_path) || path.extname(preferredName || '') || '.jpg';
  const filename = `tg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const dest = path.join(ensureReceiptsDir(), filename);
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download Telegram file (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return { absolute: dest, relative: `/uploads/receipts/${filename}` };
}

function parseAmountAndReference(caption) {
  const text = String(caption || '').trim();
  if (!text) return { amount: null, reference: null, raw: '' };

  const amountMatch = text.match(/(\d+(?:[.,]\d{1,2})?)/);
  let amount = null;
  if (amountMatch) {
    amount = Number(String(amountMatch[1]).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) amount = null;
  }

  let reference = text
    .replace(amountMatch?.[0] || '', '')
    .replace(/etb|birr|amount|ref\.?|reference|txn|transaction|id|#/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!reference) {
    // Caption was only an amount — no TXN yet
    reference = null;
  }
  return { amount, reference, raw: text };
}

async function createPendingPayment({
  customer,
  booking,
  amount,
  reference,
  receiptRelative,
  io,
}) {
  const { rows } = await query(
    `INSERT INTO payments (
       booking_id, customer_id, amount, type, method, reference_number,
       receipt_url, recorded_by, status
     ) VALUES ($1,$2,$3,'installment','telebirr',$4,$5,NULL,'pending')
     RETURNING *`,
    [
      booking?.id || null,
      customer.id,
      amount,
      reference,
      receiptRelative,
    ]
  );
  const payment = rows[0];

  io?.emit('payment:uploaded', {
    payment,
    message: `Telegram receipt from ${customer.full_name} — pending approval`,
    source: 'telegram',
  });

  const absPath = path.join(__dirname, '../..', receiptRelative.replace(/^\//, ''));
  const managerText =
    `📥 Telegram payment proof\n` +
    `<b>${customer.full_name}</b>\n` +
    `Amount: ${Number(amount).toFixed(2)} ETB\n` +
    `Transaction ID: <code>${reference}</code>\n` +
    (booking ? `Booking: ${booking.id}\n` : `Booking: not assigned yet — pick one when approving\n`) +
    `Review in RentFlow → Payments → Waiting approval`;

  await notifyManagers(managerText);
  if (fs.existsSync(absPath)) {
    try {
      const mgr = process.env.TELEGRAM_MANAGER_CHAT_ID;
      if (mgr) {
        await sendDocument(mgr, absPath, `Proof from ${customer.full_name} · ${reference}`);
      }
    } catch (err) {
      console.warn('[telegram-bot] manager proof forward failed:', err.message);
    }
  }

  return payment;
}

async function finishIntake(ctx, customer, session, io) {
  const chatId = String(ctx.chatId ?? ctx.chat?.id ?? ctx.message?.chat?.id);
  const amount = Number(session.amount);
  const reference = String(session.reference || '').trim();
  if (!reference) {
    sessions.set(chatId, { ...session, step: 'await_txn' });
    await ctx.reply('Please send your <b>transaction ID</b> (Telebirr / bank reference).', {
      parse_mode: 'HTML',
    });
    return;
  }
  if (!amount || amount <= 0) {
    sessions.set(chatId, { ...session, step: 'await_amount' });
    await ctx.reply('Please send the <b>paid amount</b> in ETB (numbers only), e.g. <code>1500</code>', {
      parse_mode: 'HTML',
    });
    return;
  }

  const booking = await findActiveBooking(customer.id);
  try {
    await createPendingPayment({
      customer,
      booking,
      amount,
      reference,
      receiptRelative: session.fileRelative,
      io,
    });
    sessions.delete(chatId);
    await ctx.reply(
      'Payment proof received ✅\n\n' +
        `Amount: <b>${amount.toFixed(2)} ETB</b>\n` +
        `Transaction ID: <code>${reference}</code>\n` +
        `Status: <b>Pending</b> — waiting for agent verification\n\n` +
        'You will receive the official RentFlow receipt here after approval.',
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('[telegram-bot] receipt failed:', err.message);
    await ctx.reply('Could not save your receipt. Please try again or visit the shop.');
  }
}

/**
 * Open-access customer bot:
 * - /start → auto-link (create customer if needed)
 * - photo/PDF + transaction ID → pending payment
 * - agent approves in RentFlow → official PDF receipt sent back here
 */
function startTelegramCustomerBot(io) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[telegram-bot] skipped — TELEGRAM_BOT_TOKEN not set');
    return null;
  }

  const bot = new Bot(token);

  bot.catch((err) => {
    console.error('[telegram-bot] handler error:', err.message || err);
  });

  bot.command('start', async (ctx) => {
    const chatId = ctx.chatId ?? ctx.chat?.id;
    if (!chatId) return;

    // Optional deep link still merges into an existing shop customer
    const payload = String(ctx.match || '').trim();
    if (payload.startsWith('c_')) {
      const customerId = payload.slice(2);
      const { rows } = await query(
        `SELECT * FROM customers WHERE id = $1 AND is_deleted = FALSE LIMIT 1`,
        [customerId]
      );
      const shopCustomer = rows[0];
      if (shopCustomer) {
        const prior = await findCustomerByChatId(chatId);
        if (prior && prior.id !== shopCustomer.id) {
          await query(
            `UPDATE customers SET telegram_chat_id = NULL WHERE id = $1`,
            [prior.id]
          );
        }
        await linkCustomerChat(shopCustomer.id, chatId);
        await ctx.reply(
          `Welcome ${shopCustomer.full_name} ✅\n\n` +
            'You can send payment proof anytime:\n' +
            '1) Photo or PDF of your receipt\n' +
            '2) Transaction ID (and amount if not in the caption)\n\n' +
            'Example caption: <code>1500 TXN12345</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }
    }

    const customer = await ensureCustomerFromTelegram(ctx);
    await ctx.reply(
      `Welcome to RentFlow${customer?.full_name ? `, ${customer.full_name}` : ''} ✅\n\n` +
        'You are linked. Send payment proof anytime:\n' +
        '• Photo or PDF of bank / Telebirr receipt\n' +
        '• Include amount + transaction ID in the caption, e.g.\n' +
        '<code>1500 TXN12345</code>\n\n' +
        'Our agent will verify it. You will get the official receipt here after approval.',
      { parse_mode: 'HTML' }
    );
  });

  bot.command('help', async (ctx) => {
    await ensureCustomerFromTelegram(ctx);
    await ctx.reply(
      'RentFlow bot:\n' +
        '1) /start — links you automatically\n' +
        '2) Send payment receipt (photo/PDF)\n' +
        '3) Send transaction ID (+ amount if asked)\n' +
        '4) Wait for agent approval — official receipt arrives here'
    );
  });

  bot.on('message', async (ctx, next) => {
    const msg = ctx.message;
    if (!msg || msg.text?.startsWith('/')) return next();

    const chatId = String(msg.chat?.id || '');
    if (!chatId) return next();

    const customer = await ensureCustomerFromTelegram(ctx);
    if (!customer) {
      await ctx.reply('Could not link your Telegram. Send /start again.');
      return;
    }

    const session = sessions.get(chatId);

    // Continue intake: transaction ID
    if (session?.step === 'await_txn' && msg.text && !msg.photo && !msg.document) {
      const { reference, amount } = parseAmountAndReference(msg.text);
      const txn = reference || String(msg.text).trim();
      if (!txn || txn.length < 3) {
        await ctx.reply('Transaction ID looks too short. Please send the full bank/Telebirr reference.');
        return;
      }
      const nextSession = {
        ...session,
        reference: txn,
        amount: session.amount || amount,
        step: session.amount || amount ? 'ready' : 'await_amount',
      };
      if (nextSession.step === 'await_amount') {
        sessions.set(chatId, nextSession);
        await ctx.reply('Thanks. Now send the <b>paid amount</b> in ETB, e.g. <code>1500</code>', {
          parse_mode: 'HTML',
        });
        return;
      }
      await finishIntake(ctx, customer, nextSession, io);
      return;
    }

    // Continue intake: amount
    if (session?.step === 'await_amount' && msg.text && !msg.photo && !msg.document) {
      const { amount } = parseAmountAndReference(msg.text);
      if (!amount) {
        await ctx.reply('Please send a number only, e.g. <code>1500</code>', { parse_mode: 'HTML' });
        return;
      }
      await finishIntake(ctx, customer, { ...session, amount, step: 'ready' }, io);
      return;
    }

    const fileId =
      msg.document?.file_id ||
      (msg.photo?.length ? msg.photo[msg.photo.length - 1].file_id : null);

    if (!fileId) {
      await ctx.reply(
        'Send a payment receipt as a <b>photo or PDF</b>.\n' +
          'Caption example: <code>1500 TXN12345</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    try {
      const saved = await downloadTelegramFile(
        fileId,
        msg.document?.file_name || 'receipt.jpg'
      );
      const caption = msg.caption || '';
      const { amount, reference } = parseAmountAndReference(caption);

      const nextSession = {
        fileRelative: saved.relative,
        amount,
        reference,
        step: !reference ? 'await_txn' : !amount ? 'await_amount' : 'ready',
      };

      if (nextSession.step === 'await_txn') {
        sessions.set(chatId, nextSession);
        await ctx.reply(
          'Receipt file saved.\nNow send your <b>transaction ID</b> (Telebirr / bank reference).',
          { parse_mode: 'HTML' }
        );
        return;
      }
      if (nextSession.step === 'await_amount') {
        sessions.set(chatId, nextSession);
        await ctx.reply(
          `Transaction ID noted: <code>${reference}</code>\n` +
            'Now send the <b>paid amount</b> in ETB, e.g. <code>1500</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      await finishIntake(ctx, customer, nextSession, io);
    } catch (err) {
      console.error('[telegram-bot] file intake failed:', err.message);
      await ctx.reply('Could not save your file. Please try again.');
    }
  });

  const apiClient = getApi();
  Promise.resolve(apiClient?.deleteWebhook({ drop_pending_updates: false }))
    .catch(() => null)
    .finally(() => {
      bot.startPolling().catch((err) => console.error('[telegram-bot] polling failed:', err.message));
      console.log('[telegram-bot] customer bot polling started (open access)');
    });

  return bot;
}

async function notifyCustomerDeadline({ customer, booking, kind, lateFee }) {
  const chatId = normalizeTelegramChatId(customer?.telegram_chat_id);
  if (!chatId) return { skipped: true };

  if (kind === 'due_soon') {
    return sendMessage(
      chatId,
      `⏰ RentFlow reminder\n` +
        `Hello ${customer.full_name},\n` +
        `Your rental return deadline is approaching: <b>${new Date(booking.end_date).toLocaleString()}</b>.\n` +
        `Please return equipment on time to avoid penalty fees.`
    );
  }

  if (kind === 'overdue') {
    return sendMessage(
      chatId,
      `⚠️ RentFlow overdue notice\n` +
        `Hello ${customer.full_name},\n` +
        `Your rental is past the return deadline.\n` +
        (lateFee
          ? `Penalty / late fee accrued: <b>${Number(lateFee).toFixed(2)} ETB</b>.\n`
          : '') +
        `Please return the equipment and settle any fees.`
    );
  }

  return { skipped: true };
}

module.exports = {
  startTelegramCustomerBot,
  notifyCustomerDeadline,
  findCustomerByChatId,
};
