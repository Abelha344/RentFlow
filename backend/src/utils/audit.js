const { query } = require('../config/db');

/**
 * Persist a sensitive action to audit_logs.
 */
async function writeAuditLog({ userId, action, targetTable, details, ipAddress }) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, target_table, details_json, ip_address)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        userId || null,
        action,
        targetTable || null,
        JSON.stringify(details || {}),
        ipAddress || null,
      ]
    );
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

module.exports = { writeAuditLog, clientIp };
