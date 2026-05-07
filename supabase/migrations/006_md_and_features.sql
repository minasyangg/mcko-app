-- Снятие теста с публикации без удаления
ALTER TABLE tests ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Индекс для быстрой фильтрации активных тестов
CREATE INDEX IF NOT EXISTS tests_is_active_idx ON tests(is_active);

-- Комментарий
COMMENT ON COLUMN tests.is_active IS 'false = тест временно снят с публикации (не виден студентам)';
