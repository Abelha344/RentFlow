const cron = require('node-cron');
const { query } = require('../config/db');

const RETENTION_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS || 90);

/**
 * Move audit_logs older than retention into audit_logs_archive, then delete from hot table.
 */
async function archiveOldAuditLogs() {
  const moved = await query(
    `WITH old_rows AS (
       SELECT id FROM audit_logs
       WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY created_at ASC
       LIMIT 5000
     ),
     inserted AS (
       INSERT INTO audit_logs_archive (
         id, user_id, action, target_table, details_json, ip_address, created_at, archived_at
       )
       SELECT a.id, a.user_id, a.action, a.target_table, a.details_json, a.ip_address, a.created_at, NOW()
       FROM audit_logs a
       JOIN old_rows o ON o.id = a.id
       ON CONFLICT (id) DO NOTHING
       RETURNING id
     )
     DELETE FROM audit_logs a
     USING inserted i
     WHERE a.id = i.id
     RETURNING a.id`,
    [RETENTION_DAYS]
  );

  return { archived: moved.rowCount || 0, retentionDays: RETENTION_DAYS };
}

function startAuditRetentionScheduler() {
  const task = cron.schedule('15 3 * * *', async () => {
    try {
      let total = 0;
      for (let i = 0; i < 50; i += 1) {
        const result = await archiveOldAuditLogs();
        total += result.archived;
        if (result.archived === 0) break;
      }
      console.log(
        `[audit-retention] archived ${total} log(s) older than ${RETENTION_DAYS} days`
      );
    } catch (err) {
      console.error('[audit-retention] failed:', err.message);
    }
  });

  console.log(
    `node-cron audit retention registered (daily 03:15, keep ${RETENTION_DAYS} days hot)`
  );
  return task;
}

module.exports = {
  startAuditRetentionScheduler,
  archiveOldAuditLogs,
  RETENTION_DAYS,
};
