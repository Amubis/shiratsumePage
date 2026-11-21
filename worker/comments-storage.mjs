const COLUMNS = 'id, target_type, target_id, parent_id, nickname, body, status, verified, created_at, updated_at, read_at';
const STATUSES = new Set(['pending', 'approved', 'rejected', 'spam', 'deleted']);
// Hidden or deleted parents also hide their replies.
const PUBLIC_COMMENT = "c.status = 'approved' AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM garden_comments p WHERE p.id = c.parent_id AND p.parent_id IS NULL AND p.status = 'approved' AND p.target_type = c.target_type AND p.target_id = c.target_id))";
const INBOX_COMMENT = `${PUBLIC_COMMENT} AND c.verified = 0`;

function commentFromRow(row) {
  if (!row) return null;
  return {
    id: row.id, targetType: row.target_type, targetId: row.target_id, parentId: row.parent_id,
    nickname: row.nickname, body: row.body, status: row.status, verified: Boolean(row.verified),
    createdAt: row.created_at, updatedAt: row.updated_at, readAt: row.read_at,
  };
}

function changes(result) { return Number(result?.meta?.changes || 0); }

/** Comments and moderation live in D1 independently of the R2 content document. */
export function createD1CommentsStore(db) {
  if (!db?.prepare) throw new Error('Bind a migrated D1 database as DB to enable comments.');
  return {
    async list({ status, unread, targetType, targetId, publicOnly = false, inbox = false, limit = 200, before } = {}) {
      const where = [];
      const values = [];
      if (inbox) where.push(INBOX_COMMENT);
      else if (publicOnly) where.push(PUBLIC_COMMENT);
      else if (status) {
        if (!STATUSES.has(status)) throw new Error('Unsupported comment status.');
        where.push('c.status = ?'); values.push(status);
      }
      if (unread === true) where.push('c.read_at IS NULL');
      if (unread === false) where.push('c.read_at IS NOT NULL');
      if (targetType) { where.push('c.target_type = ?'); values.push(targetType); }
      if (targetId) { where.push('c.target_id = ?'); values.push(targetId); }
      if (before) { where.push('c.created_at < ?'); values.push(before); }
      const boundedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Math.trunc(Number(limit)))) : 200;
      values.push(boundedLimit);
      const selected = COLUMNS.split(', ').map(column => `c.${column}`).join(', ');
      const direction = inbox ? 'DESC' : 'ASC';
      const result = await db.prepare(`SELECT ${selected} FROM garden_comments c${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY c.created_at ${direction}, c.id ${direction} LIMIT ?`).bind(...values).all();
      return (result.results || []).map(commentFromRow);
    },
    async get(id) {
      return commentFromRow(await db.prepare(`SELECT ${COLUMNS} FROM garden_comments WHERE id = ?`).bind(id).first());
    },
    async insert(comment) {
      const values = [comment.id, comment.targetType, comment.targetId, comment.parentId ?? null, comment.nickname, comment.body, comment.status, comment.verified ? 1 : 0, comment.createdAt, comment.updatedAt, comment.readAt ?? null];
      const row = await db.prepare(`INSERT INTO garden_comments (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`).bind(...values).first();
      return commentFromRow(row);
    },
    async moderate(id, { status, read } = {}, updatedAt) {
      const fields = ['updated_at = ?'];
      const values = [updatedAt];
      if (status !== undefined) {
        if (!STATUSES.has(status)) throw new Error('Unsupported comment status.');
        fields.push('status = ?'); values.push(status);
      }
      // Reviewing a message implies reading it, in the same SQL update.
      if (read === true || status !== undefined && status !== 'pending') { fields.push('read_at = COALESCE(read_at, ?)'); values.push(updatedAt); }
      values.push(id);
      return commentFromRow(await db.prepare(`UPDATE garden_comments SET ${fields.join(', ')} WHERE id = ? RETURNING ${COLUMNS}`).bind(...values).first());
    },
    async markRead({ ids, all = false, inbox = false } = {}) {
      const readAt = new Date().toISOString();
      const updateUnread = `UPDATE garden_comments AS c SET read_at = ?, updated_at = ? WHERE c.read_at IS NULL${inbox ? ` AND ${INBOX_COMMENT}` : ''}`;
      if (all) return changes(await db.prepare(updateUnread).bind(readAt, readAt).run());
      const uniqueIds = [...new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [])];
      if (!uniqueIds.length) return 0;
      // D1 limits bound parameters. Batches remain transactional and fit that limit.
      const statements = [];
      for (let index = 0; index < uniqueIds.length; index += 90) {
        const group = uniqueIds.slice(index, index + 90);
        statements.push(db.prepare(`${updateUnread} AND id IN (${group.map(() => '?').join(', ')})`).bind(readAt, readAt, ...group));
      }
      if (statements.length === 1) return changes(await statements[0].run());
      return (await db.batch(statements)).reduce((total, result) => total + changes(result), 0);
    },
    async unreadCount({ inbox = false } = {}) {
      const row = await db.prepare(`SELECT COUNT(*) AS count FROM garden_comments c WHERE c.read_at IS NULL${inbox ? ` AND ${INBOX_COMMENT}` : ''}`).first();
      return Number(row?.count || 0);
    },
    async pendingCount() {
      const row = await db.prepare("SELECT COUNT(*) AS count FROM garden_comments WHERE status = 'pending'").first();
      return Number(row?.count || 0);
    },
    async consumeRateLimit(key, nowMs, { windowMs, max }) {
      if (typeof key !== 'string' || !key || !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(windowMs) || windowMs <= 0 || !Number.isSafeInteger(max) || max <= 0) throw new Error('Invalid comment rate limit.');
      // The UPSERT increments or resets a window in one atomic SQL statement.
      const row = await db.prepare(`INSERT INTO garden_comment_rate_limits (rate_key, count, reset_at) VALUES (?, 1, ?)
        ON CONFLICT(rate_key) DO UPDATE SET
          count = CASE WHEN garden_comment_rate_limits.reset_at <= ? THEN 1 ELSE garden_comment_rate_limits.count + 1 END,
          reset_at = CASE WHEN garden_comment_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE garden_comment_rate_limits.reset_at END
        RETURNING count, reset_at`).bind(key, nowMs + windowMs, nowMs, nowMs).first();
      // Keep stale hashed address entries from accumulating indefinitely.
      await db.prepare('DELETE FROM garden_comment_rate_limits WHERE reset_at < ?').bind(nowMs - 24 * 60 * 60 * 1000).run();
      const allowed = Number(row.count) <= max;
      return { allowed, retryAfter: allowed ? 0 : Math.max(1, Math.ceil((Number(row.reset_at) - nowMs) / 1000)) };
    },
  };
}
