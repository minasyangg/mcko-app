-- Migration 012: Library extensions
ALTER TABLE exam_blueprints
  ADD COLUMN IF NOT EXISTS scoring_rule_id uuid REFERENCES scoring_rules(id) ON DELETE SET NULL;

ALTER TABLE test_tasks
  ADD COLUMN IF NOT EXISTS source_library_type text
    CHECK (source_library_type IN ('verified','custom'));
