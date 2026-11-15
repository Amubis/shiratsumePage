-- Anonymous comments contain no IP address or session token. Only a hash is
-- retained in the independent, expiring rate limit table.
CREATE TABLE IF NOT EXISTS garden_comments (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('photo', 'note')),
  target_id TEXT NOT NULL,
  parent_id TEXT REFERENCES garden_comments(id),
  nickname TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'spam', 'deleted')),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS garden_comments_target ON garden_comments (target_type, target_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS garden_comments_moderation ON garden_comments (status, created_at, id);
CREATE INDEX IF NOT EXISTS garden_comments_unread ON garden_comments (read_at, created_at, id);
CREATE INDEX IF NOT EXISTS garden_comments_parent ON garden_comments (parent_id);

CREATE TABLE IF NOT EXISTS garden_comment_rate_limits (
  rate_key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS garden_comment_rate_expiry ON garden_comment_rate_limits (reset_at);
