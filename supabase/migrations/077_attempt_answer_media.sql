-- ============================================================
-- 077_attempt_answer_media.sql — фото решения ученика к заданию попытки
-- ============================================================
--
-- Пользователь: «есть задания, которые ученик выполняет письменно
-- (вторая часть экзамена) — нужно, чтобы учитель видел решение». После
-- разведки интеграции с доской (tutpad.ru — отдельное full-page SSO-
-- приложение без embed-режима и без API «отдай картинку решения») решили
-- не втраивать доску, а сделать проще: ученик фотографирует бумажный
-- черновик и прикрепляет фото к заданию как обычную картинку — те же
-- серверные механизмы (sharp: resize+webp), что уже применяются для
-- task_media/solution_media.
--
-- Bucket отдельный от task-media (публичный, картинки УСЛОВИЯ задачи) и от
-- solution-media (эталонное решение автора/учителя, с отдельным потоком
-- одобрения solution_requests) — здесь персональные черновики ученика,
-- смешивать с любым из двух смыслов не стоит (см. project-level разбор).
--
-- Bucket приватный: запись — ТОЛЬКО через API-роут с admin-клиентом
-- (app/api/attempts/[id]/tasks/[taskId]/solution-media), который сам
-- проверяет через RLS-клиента, что попытка принадлежит текущему ученику и
-- ещё не сдана (status='in_progress') — прямой insert с фронта в Storage
-- не предусмотрен (тот же паттерн, что task-media/solution-media). Поэтому
-- storage-политика на insert/delete — только teacher/admin (для ручного
-- администрирования), обычный путь записи идёт в обход RLS через
-- service-role в самом API-роуте.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-solution-media',
  'student-solution-media',
  false,
  5242880, -- 5MB на файл, после sharp-сжатия реальный размер заметно меньше
  array['image/webp','image/jpeg','image/png']
)
on conflict (id) do nothing;

create policy "student-solution-media: teacher/admin manage"
  on storage.objects for all
  using (
    bucket_id = 'student-solution-media'
    and auth_role() in ('teacher','admin')
  );

-- Доступ ученику и учителю на чтение выдаётся сервером через signed URL
-- (createSignedUrls) после проверки RLS на attempt_answer_media ниже —
-- сама Storage-политика read не нужна публичному/authenticated: сервер уже
-- проверил владение до выдачи подписанной ссылки (тот же подход, что и у
-- solution-media после миграции 030 — там как раз убрали избыточное
-- "authenticated read").

-- ============================================================
-- Таблица attempt_answer_media
-- ============================================================
-- Привязана к (attempt_id, task_id) напрямую, а не к
-- attempt_task_answers.id — фото может быть единственным ответом на
-- manual_review-задание (ученик ничего не печатал в textarea), и
-- attempt_task_answers создаётся лениво при первом сохранении текста;
-- ждать её существования ради фото было бы лишней связью.
create table if not exists attempt_answer_media (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts(id) on delete cascade,
  task_id uuid not null references test_tasks(id) on delete cascade,
  storage_path text not null,
  format text not null default 'webp',
  width_px integer,
  height_px integer,
  file_size_bytes integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists attempt_answer_media_attempt_task_idx
  on attempt_answer_media (attempt_id, task_id);

-- Не более 2 фото на (attempt_id, task_id) — обеспечивается в API-роуте
-- (count перед insert), но частичный уникальный индекс на sort_order
-- (0 или 1) страхует от гонки двух параллельных запросов на упорку той же
-- пары ячеек.
create unique index if not exists attempt_answer_media_slot_idx
  on attempt_answer_media (attempt_id, task_id, sort_order);

alter table attempt_answer_media enable row level security;

-- Ученик управляет только своими медиа собственной (ещё не сданной)
-- попытки — то же условие track_startable/update, что и у attempts самой.
create policy "attempt_answer_media: student manage own attempt"
  on attempt_answer_media for all
  using (
    auth_role() = 'student'
    and exists (select 1 from attempts a where a.id = attempt_id and a.student_id = auth.uid())
  )
  with check (
    auth_role() = 'student'
    and exists (select 1 from attempts a where a.id = attempt_id and a.student_id = auth.uid())
  );

create policy "attempt_answer_media: teacher read own assignments"
  on attempt_answer_media for select
  using (
    auth_role() = 'teacher'
    and check_attempt_assignment_owned_by_auth(attempt_id)
  );

create policy "attempt_answer_media: admin read org"
  on attempt_answer_media for select
  using (
    auth_role() = 'admin'
    and check_attempt_in_auth_org(attempt_id)
  );
