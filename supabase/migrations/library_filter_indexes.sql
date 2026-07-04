-- library_filter_indexes
-- Recorded as applied in the live DB (2026-06-07) but never committed as a file.
-- Corresponds to commit 6e1b6ba "refactor: extract LibraryFilter component + debounce + URL state + DB indexes".

-- Partial composite index: subject+exam_type listing (no topic filter)
-- Covers the most common "open library" query with scraped_at ordering
CREATE INDEX IF NOT EXISTS idx_lib_prob_listing
  ON library_problems (subject, exam_type, scraped_at DESC NULLS LAST, source_id ASC)
  WHERE is_active = true AND organization_id IS NULL;

-- Partial composite index: topic + subject + exam_type listing
-- Covers filtered-by-topic queries with scraped_at ordering
CREATE INDEX IF NOT EXISTS idx_lib_prob_topic_listing
  ON library_problems (canonical_topic_id, subject, exam_type, scraped_at DESC NULLS LAST, source_id ASC)
  WHERE is_active = true AND organization_id IS NULL;

-- Index for has_answer filter combined with subject+exam
CREATE INDEX IF NOT EXISTS idx_lib_prob_answer_listing
  ON library_problems (subject, exam_type, has_answer, scraped_at DESC NULLS LAST)
  WHERE is_active = true AND organization_id IS NULL;

-- Partial index for FIPI source filter
CREATE INDEX IF NOT EXISTS idx_lib_prob_source_domain
  ON library_problems (source_domain, subject, exam_type, scraped_at DESC NULLS LAST)
  WHERE is_active = true AND organization_id IS NULL;
