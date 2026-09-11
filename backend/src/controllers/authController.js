const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { writeAuditLog, clientIp } = require('../utils/audit');
const { authCookieOptions } = require('../utils/cookies');

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      full_name: user.full_name,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const { rows } = await query(
      `SELECT id, full_name, email, password_hash, role, is_active
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = signToken(user);
    res.cookie('access_token', token, authCookieOptions());

    await writeAuditLog({
      userId: user.id,
      action: 'user.login',
      targetTable: 'users',
      details: { email: user.email },
      ipAddress: clientIp(req),
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res) {
  res.clearCookie('access_token', authCookieOptions());
  res.json({ success: true, message: 'Logged out' });
}

async function me(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, full_name, email, role, created_at FROM users WHERE id = $1 AND is_active = TRUE`,
      [req.user.id]
    );
    if (!rows[0]) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function listUsers(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, full_name, email, role, is_active, created_at
       FROM users
       WHERE is_active = TRUE
       ORDER BY created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

async function createUser(req, res, next) {
  try {
    const { full_name, email, password, role } = req.body;
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, email, role, is_active, created_at`,
      [full_name, email.toLowerCase(), hash, role]
    );

    await writeAuditLog({
      userId: req.user.id,
      action: 'user.create',
      targetTable: 'users',
      details: { created_user_id: rows[0].id, role },
      ipAddress: clientIp(req),
    });

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const { full_name, role, is_active, password } = req.body;

    if (role && id === req.user.id && role !== req.user.role) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own role',
      });
    }

    let hashClause = '';
    const params = [full_name ?? null, role ?? null, is_active ?? null, id];
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      hashClause = ', password_hash = $5';
      params.push(hash);
    }

    const { rows } = await query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           role = COALESCE($2, role),
           is_active = COALESCE($3, is_active)
           ${hashClause}
       WHERE id = $4
       RETURNING id, full_name, email, role, is_active, created_at`,
      params
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await writeAuditLog({
      userId: req.user.id,
      action: 'user.update',
      targetTable: 'users',
      details: { target_user_id: id, role, is_active, full_name },
      ipAddress: clientIp(req),
    });

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/**
 * Permanently terminate a staff user (hard delete). Admin only.
 * Blocks self-delete and deleting the last active admin.
 * History rows keep amounts; staff FK fields are cleared.
 */
async function nullifyUserReferences(userId, clientQuery = query) {
  await clientQuery(`UPDATE payments SET recorded_by = NULL WHERE recorded_by = $1`, [userId]);
  await clientQuery(`UPDATE rental_returns SET returned_by = NULL WHERE returned_by = $1`, [
    userId,
  ]);
  await clientQuery(`UPDATE bookings SET created_by = NULL WHERE created_by = $1`, [userId]);
  await clientQuery(`UPDATE store_settings SET updated_by = NULL WHERE updated_by = $1`, [
    userId,
  ]);
  await clientQuery(`UPDATE audit_logs SET user_id = NULL WHERE user_id = $1`, [userId]);
}

async function deleteUser(req, res, next) {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot terminate your own account',
      });
    }

    const target = await query(
      `SELECT id, email, role, is_active, full_name FROM users WHERE id = $1`,
      [id]
    );
    if (!target.rows[0]) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (target.rows[0].role === 'admin' && target.rows[0].is_active) {
      const admins = await query(
        `SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND is_active = TRUE`
      );
      if (admins.rows[0].c <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot terminate the last active admin',
        });
      }
    }

    await nullifyUserReferences(id);
    await query(`DELETE FROM users WHERE id = $1`, [id]);

    await writeAuditLog({
      userId: req.user.id,
      action: 'user.terminate',
      targetTable: 'users',
      details: {
        target_user_id: id,
        email: target.rows[0].email,
        role: target.rows[0].role,
        full_name: target.rows[0].full_name,
      },
      ipAddress: clientIp(req),
    });

    res.json({
      success: true,
      message: 'Staff account terminated and removed',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login,
  logout,
  me,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
};
