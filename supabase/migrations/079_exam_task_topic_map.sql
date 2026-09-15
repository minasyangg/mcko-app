-- Соответствие «номер задания в варианте экзамена → тема кодификатора».
--
-- Зачем: агент автосборки ДЗ (project_homework_agent) должен определять, по
-- какой теме кодификатора ученик ошибся. Для задач с library_problem_id это
-- напрямую library_problems.canonical_topic_id/topic_id. Но проверка живой
-- базы (2026-09-16) показала: из 567 ошибок в attempt_task_answers только 39
-- имеют ссылку на источник (17 library + 22 book) — 528 (93%) это задачи из
-- PDF-тестов (загруженных напрямую через сайт), у которых НЕТ ни
-- library_problem_id, ни book_problem_id. Без этой таблицы агент был бы слеп
-- на 93% реальных данных.
--
-- Номер задания в варианте ОГЭ/ЕГЭ жёстко привязан к теме кодификатора
-- (задание №5 варианта ОГЭ-математика — всегда один и тот же тип/тема,
-- независимо от конкретного варианта) — это и даёт мост «task_number →
-- library_topic_id» без ссылки на конкретную задачу.
create table if not exists exam_task_topic_map (
  id uuid primary key default gen_random_uuid(),
  exam_type text not null,          -- 'ОГЭ' | 'ЕГЭ' — как в tests.exam_type/library_topics.exam_type
  subject text not null,
  task_number int not null,         -- номер задания в варианте (test_tasks.task_number)
  library_topic_id uuid not null references library_topics(id) on delete cascade,
  fipi_code text,                   -- код кодификатора, дубль library_topics.fipicod для читаемости выборок
  fgos_grade text,                  -- в каком классе тема проходится по ФГОС — для различения «пробел» / «впереди»
  weight numeric not null default 1 check (weight > 0), -- вес, если один номер покрывает несколько тем
  created_at timestamptz not null default now(),
  unique (exam_type, subject, task_number, library_topic_id)
);

create index if not exists idx_ettm_lookup on exam_task_topic_map (exam_type, subject, task_number);
create index if not exists idx_ettm_topic on exam_task_topic_map (library_topic_id);

comment on table exam_task_topic_map is
  'Соответствие «номер задания в варианте → тема кодификатора» — позволяет диагностировать ошибки в PDF-тестах без ссылки на library_problem_id/book_problem_id (93% ошибок в базе на 2026-09-16). См. project_homework_agent.';

-- Читают все учителя/админы своей организации — справочник общий, не
-- персональный (как library_topics, у которых RLS на select тоже открыт всем
-- ролям teacher/admin). Пишет только service_role (наполнение — скриптом).
alter table exam_task_topic_map enable row level security;

create policy "exam_task_topic_map: read for staff" on exam_task_topic_map
  for select using (auth_role() = any (array['teacher', 'admin']));

create policy "exam_task_topic_map: write service role only" on exam_task_topic_map
  for all using (false);
