-- ============================================================
-- 037_doska_student_boards.sql
-- Постоянная привязка «ученик ↔ доска» для интеграции с доской-приложением
-- (отдельный проект doska, canvas + WebSocket, без своей БД для контента).
-- Таблица с префиксом doska_* — чисто аддитивная часть схемы, ничего
-- существующего не меняет и не затрагивает.
--
-- Одна строка = одна постоянная доска на пару учитель-ученик. board_id —
-- идентификатор доски в doska (её собственный короткий id, не uuid — сама
-- доска генерирует id вида 'b'+10 случайных символов и хранит содержимое
-- в своём файловом хранилище, а не здесь). Идентичность учителя в doska
-- уже проверяется через Supabase access-токен (verifySupabaseUser на
-- стороне doska) — эта таблица только запоминает, какая доска закреплена
-- за каким учеником, само содержимое доски здесь не хранится и не должно.
-- ============================================================

create table if not exists doska_student_boards (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  board_id text not null,
  created_at timestamptz not null default now(),
  unique (teacher_id, student_id)
);

create index if not exists idx_doska_student_boards_teacher on doska_student_boards(teacher_id);
create index if not exists idx_doska_student_boards_student on doska_student_boards(student_id);

alter table doska_student_boards enable row level security;

-- Учитель видит привязки, где он владелец доски.
create policy "doska_student_boards: teacher reads own" on doska_student_boards
  for select using (teacher_id = auth.uid());

-- Ученик видит свою собственную постоянную доску (для ссылки в своём кабинете).
create policy "doska_student_boards: student reads own" on doska_student_boards
  for select using (student_id = auth.uid());

-- Admin — видит привязки учеников своей организации (для поддержки/аудита).
create policy "doska_student_boards: admin reads org" on doska_student_boards
  for select using (
    auth_role() = 'admin'
    and exists (
      select 1 from profiles p
      where p.id = doska_student_boards.student_id and p.organization_id = auth_org()
    )
  );

-- Запись — только через service role (API-роут создания доски использует
-- createAdminClient(), см. lib/supabase/admin.ts), как и в teacher_students.
create policy "doska_student_boards: write service role only" on doska_student_boards
  for all using (false);
