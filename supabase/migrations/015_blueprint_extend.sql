-- 015_blueprint_extend
-- Recorded as applied in the live DB (2026-06-07) but never committed as a file.
-- Corresponds to the now-lost commit 615b8f1 "feat: exam blueprints tab — PDF parsing + blueprint CRUD"
-- (application code for that commit is unrecoverable — schema only).

-- Extend exam_blueprint_sections: add topic_ids array, task_number, note
alter table exam_blueprint_sections
  add column if not exists topic_ids   uuid[]  not null default '{}',
  add column if not exists task_number int,
  add column if not exists note        text;

-- Migrate existing single topic_id → topic_ids (non-destructive)
update exam_blueprint_sections
  set topic_ids = array[topic_id]
  where topic_id is not null and topic_ids = '{}';

-- Extend exam_blueprints: add time + max score
alter table exam_blueprints
  add column if not exists total_time_minutes int,
  add column if not exists max_score          int;
