const voteTotals = 'SUM(weight) AS count, MAX(CASE WHEN visitor_hash = ? THEN weight ELSE 0 END) AS weight';
const record = (photoId, row) => {
  const weight = Number(row?.weight || 0);
  return { photoId, count: Number(row?.count || 0), liked: weight > 0, weight };
};

/** Each visitor contributes at most one row; there is no mutable count to drift. */
export function createD1PhotoLikesStore(db) {
  if (!db?.prepare || !db?.batch) throw new Error('Bind a migrated D1 database to enable photo likes.');
  return {
    async list(photoIds, visitorHash = '') {
      const ids = [...new Set(photoIds)];
      const counts = new Map();
      // Leave room for the visitor parameter within D1's 100-bind limit.
      for (let index = 0; index < ids.length; index += 90) {
        const group = ids.slice(index, index + 90);
        const result = await db.prepare(`SELECT photo_id, ${voteTotals} FROM photo_likes WHERE photo_id IN (${group.map(() => '?').join(',')}) GROUP BY photo_id`).bind(visitorHash, ...group).all();
        for (const row of result.results || []) counts.set(row.photo_id, row);
      }
      return ids.map(id => record(id, counts.get(id)));
    },
    async set(photoId, visitorHash, liked, createdAt, weight = 1) {
      // D1 batch is transactional, so the returned state follows this exact
      // write even with simultaneous requests from different visitors.
      const change = liked
        ? db.prepare(`INSERT INTO photo_likes (photo_id, visitor_hash, created_at, weight) VALUES (?, ?, ?, ?)
          ON CONFLICT(photo_id, visitor_hash) DO UPDATE SET weight = excluded.weight
          WHERE excluded.weight > photo_likes.weight`).bind(photoId, visitorHash, createdAt, weight)
        : db.prepare('DELETE FROM photo_likes WHERE photo_id = ? AND visitor_hash = ?').bind(photoId, visitorHash);
      const read = db.prepare(`SELECT ${voteTotals} FROM photo_likes WHERE photo_id = ?`).bind(visitorHash, photoId);
      const results = await db.batch([change, read]);
      return record(photoId, results[1]?.results?.[0]);
    },
    async consumeRateLimit(key, nowMs, { windowMs, max }) {
      const row = await db.prepare(`INSERT INTO photo_like_rate_limits (visitor_hash, count, reset_at) VALUES (?, 1, ?)
        ON CONFLICT(visitor_hash) DO UPDATE SET
          count = CASE WHEN photo_like_rate_limits.reset_at <= ? THEN 1 ELSE photo_like_rate_limits.count + 1 END,
          reset_at = CASE WHEN photo_like_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE photo_like_rate_limits.reset_at END
        RETURNING count, reset_at`).bind(key, nowMs + windowMs, nowMs, nowMs).first();
      await db.prepare('DELETE FROM photo_like_rate_limits WHERE reset_at < ?').bind(nowMs - 24 * 60 * 60 * 1000).run();
      const allowed = Number(row.count) <= max;
      return { allowed, retryAfter: allowed ? 0 : Math.max(1, Math.ceil((Number(row.reset_at) - nowMs) / 1000)) };
    },
  };
}
