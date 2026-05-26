-- Поле has_answer: вычисляемое, хранимое, индексируемое — для фильтрации в сборщике тестов
ALTER TABLE library_problems
  ADD COLUMN IF NOT EXISTS has_answer boolean
  GENERATED ALWAYS AS (correct_answer IS NOT NULL) STORED;

CREATE INDEX IF NOT EXISTS idx_library_problems_has_answer
  ON library_problems(has_answer);

-- Источник ответа: 'scraped' (из источника), 'manual' (учитель), 'ai' (ИИ), 'none'
ALTER TABLE library_problems
  ADD COLUMN IF NOT EXISTS answer_source text NOT NULL DEFAULT 'none';

ALTER TABLE library_problems
  ADD CONSTRAINT chk_answer_source
  CHECK (answer_source IN ('scraped', 'manual', 'ai', 'none'));

-- Проставить 'scraped' для уже импортированных задач с ответами
UPDATE library_problems
  SET answer_source = 'scraped'
  WHERE correct_answer IS NOT NULL AND answer_source = 'none';

COMMENT ON COLUMN library_problems.has_answer IS
  'Вычисляемое поле: true если задача имеет ответ для автопроверки';
COMMENT ON COLUMN library_problems.answer_source IS
  'Источник ответа: scraped=из парсера, manual=добавлен учителем, ai=вычислен ИИ, none=нет ответа';
