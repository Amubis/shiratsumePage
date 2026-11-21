-- Existing votes contribute one like; a charged vote can be worth five.
ALTER TABLE photo_likes ADD COLUMN weight INTEGER NOT NULL DEFAULT 1 CHECK (weight IN (1, 5));
