-- canonical_topics
-- Recorded as applied in the live DB (2026-06-03) but never committed as a file.
-- Corresponds to commit 2ac7656 "feat: library — canonical topics filter, toggle-group UI, active chips".

-- Canonical topic classification field
ALTER TABLE library_problems
  ADD COLUMN IF NOT EXISTS canonical_topic_id uuid REFERENCES library_topics(id);

-- Mark canonical topics (preferred when duplicates exist)
ALTER TABLE library_topics
  ADD COLUMN IF NOT EXISTS is_canonical boolean NOT NULL DEFAULT false;

-- Index for fast filtering by canonical topic
CREATE INDEX IF NOT EXISTS idx_lib_prob_canonical_topic
  ON library_problems(canonical_topic_id);

-- Index for canonical topic lookup
CREATE INDEX IF NOT EXISTS idx_lib_topics_canonical
  ON library_topics(exam_type, subject, is_canonical)
  WHERE is_canonical = true;
