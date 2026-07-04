-- add_preserve_answers_to_assignments
-- Recorded as applied in the live DB (2026-05-04) but never committed as a file.
-- Reconstructed from supabase_migrations.schema_migrations.statements.

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS preserve_answers BOOLEAN NOT NULL DEFAULT FALSE;
