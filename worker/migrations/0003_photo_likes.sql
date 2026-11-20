-- Anonymous browsers receive a random cookie; only a salted hash is retained.
-- Likes are independent of R2 content publishing and owner authentication.
CREATE TABLE IF NOT EXISTS photo_likes (
  photo_id TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (photo_id, visitor_hash)
);

CREATE TABLE IF NOT EXISTS photo_like_rate_limits (
  visitor_hash TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS photo_like_rate_expiry ON photo_like_rate_limits (reset_at);
