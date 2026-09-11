const { query } = require('../config/db');
const { writeAuditLog, clientIp } = require('../utils/audit');
const { normalizeTelegramChatId, telegramChatIdError, customerTelegramInviteLink } = require('../utils/telegram');
const { BOOKING_MONEY_SQL, attachPayStatus } = require('../utils/bookingMoney');

async function listCustomers(req, res, next) {
  try {
    const { search, low_rating } = req.query;
    const params = [];
    const clauses = ['is_deleted = FALSE'];

    if (search) {
      params.push(`%${search}%`);
      clauses.push(
        `(full_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length} OR address ILIKE $${params.length})`
      );
    }
    if (low_rating === 'true') {
      clauses.push('rating < 3');
    }

    const { rows } = await query(
      `SELECT * FROM customers WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

async function getCustomer(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT * FROM customers WHERE id = $1 AND is_deleted = FALSE`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const history = await query(
      `SELECT b.id, b.start_date, b.end_date, b.status, b.total_amount, b.collateral_deposit, b.created_at,
              ${BOOKING_MONEY_SQL}
       FROM bookings b
       WHERE b.customer_id = $1
       ORDER BY b.created_at DESC
       LIMIT 20`,
      [req.params.id]
    );

    const bookings = history.rows.map(attachPayStatus);
    const total_outstanding = bookings
      .filter((b) => b.status !== 'cancelled')
      .reduce((s, b) => s + Number(b.balance_due || 0), 0);

    res.json({
      success: true,
      data: {
        ...rows[0],
        requires_higher_collateral: rows[0].rating < 3,
        telegram_linked: Boolean(normalizeTelegramChatId(rows[0].telegram_chat_id)),
        invite_link: customerTelegramInviteLink(rows[0].id),
        total_outstanding,
        bookings,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function createCustomer(req, res, next) {
  try {
    const {
      full_name,
      phone,
      email,
      address,
      id_number,
      rating = 3,
      notes,
      telegram_chat_id,
    } = req.body;
    if (!String(address || '').trim()) {
      return res.status(400).json({ success: false, message: 'Address is required' });
    }
    if (telegram_chat_id && String(telegram_chat_id).trim() && !normalizeTelegramChatId(telegram_chat_id)) {
      return res.status(400).json({
        success: false,
        message: telegramChatIdError(telegram_chat_id),
      });
    }
    const chatId = normalizeTelegramChatId(telegram_chat_id);
    const idCardUrl = req.file ? `/uploads/kyc/${req.file.filename}` : null;

    const { rows } = await query(
      `INSERT INTO customers (full_name, phone, email, address, id_number, id_card_url, rating, notes, telegram_chat_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        full_name,
        phone || null,
        email || null,
        String(address).trim(),
        id_number || null,
        idCardUrl,
        rating,
        notes || null,
        chatId,
      ]
    );

    res.status(201).json({
      success: true,
      data: {
        ...rows[0],
        requires_higher_collateral: rows[0].rating < 3,
        telegram_linked: Boolean(chatId),
        invite_link: customerTelegramInviteLink(rows[0].id),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateCustomer(req, res, next) {
  try {
    const { id } = req.params;
    const { full_name, phone, email, address, id_number, rating, notes, telegram_chat_id } =
      req.body;

    const existing = await query(
      `SELECT * FROM customers WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!existing.rows[0]) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (address !== undefined && !String(address || '').trim()) {
      return res.status(400).json({ success: false, message: 'Address is required' });
    }

    let idCardUrl = existing.rows[0].id_card_url;
    if (req.file) {
      idCardUrl = `/uploads/kyc/${req.file.filename}`;
    }

    let nextTelegramId = existing.rows[0].telegram_chat_id;
    if (telegram_chat_id !== undefined) {
      if (telegram_chat_id && String(telegram_chat_id).trim() && !normalizeTelegramChatId(telegram_chat_id)) {
        return res.status(400).json({
          success: false,
          message: telegramChatIdError(telegram_chat_id),
        });
      }
      nextTelegramId = normalizeTelegramChatId(telegram_chat_id);
    }

    if (rating !== undefined && Number(rating) !== Number(existing.rows[0].rating)) {
      await writeAuditLog({
        userId: req.user.id,
        action: 'customer.rating_change',
        targetTable: 'customers',
        details: { customer_id: id, from: existing.rows[0].rating, to: rating },
        ipAddress: clientIp(req),
      });
    }

    const { rows } = await query(
      `UPDATE customers SET
         full_name = COALESCE($1, full_name),
         phone = COALESCE($2, phone),
         email = COALESCE($3, email),
         address = COALESCE($4, address),
         id_number = COALESCE($5, id_number),
         id_card_url = COALESCE($6, id_card_url),
         rating = COALESCE($7, rating),
         notes = COALESCE($8, notes),
         telegram_chat_id = $9
       WHERE id = $10
       RETURNING *`,
      [
        full_name ?? null,
        phone ?? null,
        email ?? null,
        address !== undefined ? String(address).trim() : null,
        id_number ?? null,
        idCardUrl,
        rating ?? null,
        notes ?? null,
        nextTelegramId,
        id,
      ]
    );

    res.json({
      success: true,
      data: {
        ...rows[0],
        requires_higher_collateral: rows[0].rating < 3,
        telegram_linked: Boolean(normalizeTelegramChatId(rows[0].telegram_chat_id)),
        invite_link: customerTelegramInviteLink(rows[0].id),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function softDeleteCustomer(req, res, next) {
  try {
    const { rows } = await query(
      `UPDATE customers SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    res.json({ success: true, message: 'Customer soft-deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  softDeleteCustomer,
};
