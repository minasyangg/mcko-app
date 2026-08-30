-- Атомарный "замок" на довершение PDF-импорта после PaddleOCR: несколько
-- учителей могут опрашивать статус конкурентно (несколько вкладок, повторный
-- опрос) — finalizing_at гарантирует, что запись заданий в БД произойдёт
-- только один раз (claim через UPDATE ... WHERE finalizing_at IS NULL).
alter table parsing_jobs add column if not exists finalizing_at timestamptz;

comment on column parsing_jobs.finalizing_at is
  'Метка "довершение импорта началось" — атомарный claim, чтобы конкурентные опросы GET /api/parsing/jobs/[id] не сохранили задания дважды.';
