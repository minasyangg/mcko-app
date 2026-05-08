-- Блокировка ответа учителем: задание засчитано и не может быть перезаписано студентом
ALTER TABLE attempt_task_answers
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

-- Ссылка на попытку, в которой учитель подтвердил ответ
ALTER TABLE attempt_task_answers
  ADD COLUMN IF NOT EXISTS locked_in_attempt_id uuid REFERENCES attempts(id) ON DELETE SET NULL;

-- Индекс для быстрого поиска заблокированных ответов по заданию
CREATE INDEX IF NOT EXISTS attempt_task_answers_locked_idx
  ON attempt_task_answers(task_id, is_locked) WHERE is_locked = true;

COMMENT ON COLUMN attempt_task_answers.is_locked
  IS 'true = учитель подтвердил верный ответ; задание заблокировано для студента в будущих попытках';

COMMENT ON COLUMN attempt_task_answers.locked_in_attempt_id
  IS 'попытка, в которой учитель поставил is_locked=true';
