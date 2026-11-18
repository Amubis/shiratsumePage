-- A completed review implies that the administrator has read the message.
-- Keep existing read timestamps and use the original review time for old rows.
UPDATE garden_comments
SET read_at = COALESCE(updated_at, created_at)
WHERE read_at IS NULL AND status IN ('approved', 'rejected', 'spam', 'deleted');
