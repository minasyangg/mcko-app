-- ============================================================
-- 087_assignment_sharing.sql
-- Ученик, сдавший работу, может показать её другому учителю (не тому, кто
-- назначил) — по инициативе ученика, но только тому, кого admin явно
-- разрешил (whitelist), и только пока грант не истёк/не отозван.
--
-- Это НЕ отменяет и не заменяет существующую модель видимости
-- (teacher_students, 019 — прикреплённый учитель НЕ видит чужие назначения;
-- владение назначением через check_attempt_assignment_owned_by_auth, 018) —
-- новый канал строго параллельный, аддитивный (только новые SELECT-политики
-- рядом с существующими). Паттерн точечного грант-объекта — по образцу
-- book_editors (018): грант на конкретный объект конкретному человеку,
-- запись — только через API, не напрямую с клиента.
-- ============================================================

-- ── 1. student_share_settings — admin-рубильник + дефолт TTL (per-student) ──
-- Отдельная таблица, не boolean-столбец в profiles: настройка одной фичи со
-- своими полями, которая должна жить и без единой строки whitelist.
create table if not exists student_share_settings (
  student_id       uuid primary key references profiles(id) on delete cascade,
  enabled          boolean not null default false, -- admin включает осознанно
  default_ttl_days smallint not null default 14 check (default_ttl_days between 1 and 90),
  updated_by       uuid references profiles(id),
  updated_at       timestamptz not null default now()
);

comment on table student_share_settings is
  'Admin-рубильник "ученику разрешено делиться сданными работами" + дефолт срока действия
   гранта в днях. Per-student, не глобальный флаг. Отсутствие строки = шаринг выключен
   (безопасный дефолт). См. student_share_recipients, assignment_shares (087).';

-- ── 2. student_share_recipients — whitelist получателей (admin, per pair) ───
create table if not exists student_share_recipients (
  student_id  uuid not null references profiles(id) on delete cascade,
  teacher_id  uuid not null references profiles(id) on delete cascade,
  granted_by  uuid references profiles(id), -- admin, кто добавил в whitelist
  created_at  timestamptz not null default now(),
  primary key (student_id, teacher_id)
);

create index if not exists idx_share_recipients_teacher on student_share_recipients(teacher_id);

comment on table student_share_recipients is
  'Персональный whitelist учителей-получателей для конкретного ученика. Составляется admin,
   акт шаринга делает ученик (assignment_shares). Точечный грант объект->человек, по образцу
   book_editors (018) — не путать с teacher_students (019, видимость назначений остаётся по
   владению, не по прикреплению).';

-- ── 3. assignment_shares — сам акт шаринга (студент -> учитель, на assignment) ──
-- По assignment_id, не attempt_id: при пересдаче получатель должен видеть
-- актуальный итог, а не приросшую к первой попытке ссылку.
create table if not exists assignment_shares (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id    uuid not null references profiles(id) on delete cascade,
  teacher_id    uuid not null references profiles(id) on delete cascade, -- получатель
  granted_by    uuid not null references profiles(id), -- = student_id, для консистентности с book_editors.granted_by
  expires_at    timestamptz not null,
  revoked_at    timestamptz, -- явный отзыв учеником; отдельно от expires_at (пассивное истечение vs активное действие)
  created_at    timestamptz not null default now(),

  -- один активный грант на пару (assignment, teacher) — повторный "поделиться"
  -- продлевает существующий (upsert), не плодит дубликаты у получателя
  unique (assignment_id, teacher_id)
);

create index if not exists idx_assignment_shares_student on assignment_shares(student_id);
create index if not exists idx_assignment_shares_teacher on assignment_shares(teacher_id);
create index if not exists idx_assignment_shares_assignment on assignment_shares(assignment_id);

comment on table assignment_shares is
  'Точечный грант "ученик показал сданную работу другому учителю" — по assignment_id, не
   attempt_id: при пересдаче получатель видит актуальный итог, а не приросшую к первой попытке
   ссылку. Параллельный канал видимости к teacher_students (019)/
   check_attempt_assignment_owned_by_auth (018) — RLS attempts/attempt_task_answers/
   student_final_results/task_answer_keys дополнена (не заменена) политикой "есть активный
   неотозванный неистёкший грант". Запись — только через API от имени ученика (service role).';

-- ── 4. Хелпер-функции авторизации (security definer, паттерн 018) ───────────

-- Whitelist: этому ученику разрешено делиться с этим учителем?
create or replace function check_student_may_share_with(p_student_id uuid, p_teacher_id uuid)
returns boolean as $$
  select exists (
    select 1
    from student_share_settings s
    join student_share_recipients r
      on r.student_id = s.student_id and r.teacher_id = p_teacher_id
    where s.student_id = p_student_id and s.enabled = true
  )
$$ language sql security definer stable set search_path = public;

-- Активный (не истёкший, не отозванный) грант на assignment для текущего получателя?
create or replace function check_assignment_shared_with_auth(p_assignment_id uuid)
returns boolean as $$
  select exists (
    select 1 from assignment_shares
    where assignment_id = p_assignment_id
      and teacher_id = auth.uid()
      and revoked_at is null
      and now() < expires_at
  )
$$ language sql security definer stable set search_path = public;

-- То же, но от attempt_id (attempt_task_answers не хранит assignment_id
-- напрямую) — плюс терминальный статус: черновик (in_progress) не показываем.
create or replace function check_attempt_shared_with_auth(p_attempt_id uuid)
returns boolean as $$
  select exists (
    select 1 from attempts a
    join assignment_shares s on s.assignment_id = a.assignment_id
    where a.id = p_attempt_id
      and s.teacher_id = auth.uid()
      and s.revoked_at is null
      and now() < s.expires_at
      and a.status in ('submitted','checked')
  )
$$ language sql security definer stable set search_path = public;

-- task_answer_keys: AttemptDrawer читает эталонные ответы по task_id —
-- получателю тоже нужно их видеть ("условия" включают эталон). Ограничено
-- задачами тестов, реально расшаренных этому учителю (не всеми тестами
-- составителя вообще).
create or replace function check_task_shared_with_auth(p_task_id uuid)
returns boolean as $$
  select exists (
    select 1 from test_tasks tt
    join assignments a on a.test_version_id = tt.test_version_id
    join assignment_shares s on s.assignment_id = a.id
    where tt.id = p_task_id
      and s.teacher_id = auth.uid()
      and s.revoked_at is null
      and now() < s.expires_at
  )
$$ language sql security definer stable set search_path = public;

-- Функции возвращают данные о чужом пользователе — анонимному клиенту
-- вызывать их незачем, конвенция 086.
revoke execute on function check_student_may_share_with(uuid, uuid) from anon;
revoke execute on function check_assignment_shared_with_auth(uuid) from anon;
revoke execute on function check_attempt_shared_with_auth(uuid) from anon;
revoke execute on function check_task_shared_with_auth(uuid) from anon;

-- ── 5. RLS на новых таблицах ─────────────────────────────────────────────────
alter table student_share_settings enable row level security;
alter table student_share_recipients enable row level security;
alter table assignment_shares enable row level security;

-- student_share_settings: ученик читает своё, admin читает/пишет всю
-- организацию, учитель НЕ читает (внутренняя настройка admin<->student).
create policy "sss: student reads own" on student_share_settings
  for select using (student_id = auth.uid());

create policy "sss: admin manage org" on student_share_settings
  for all
  using (auth_role() = 'admin' and check_student_in_auth_org(student_id))
  with check (auth_role() = 'admin' and check_student_in_auth_org(student_id));

-- student_share_recipients: ученик читает свой whitelist (нужно для UI
-- выбора получателя), учитель-получатель видит запись про себя, admin управляет.
create policy "ssr: student reads own" on student_share_recipients
  for select using (student_id = auth.uid());

create policy "ssr: teacher reads own as recipient" on student_share_recipients
  for select using (teacher_id = auth.uid());

create policy "ssr: admin manage org" on student_share_recipients
  for all
  using (auth_role() = 'admin' and check_student_in_auth_org(student_id))
  with check (
    auth_role() = 'admin'
    and check_student_in_auth_org(student_id)
    and check_student_in_auth_org(teacher_id) -- получатель тоже сотрудник этой организации
  );

-- assignment_shares: пишет только service role (роут от имени студента после
-- явных проверок whitelist+статуса — RLS insert-check не умеет удобно читать
-- три таблицы одним выражением с понятными UI-ошибками).
create policy "ashares: student reads own" on assignment_shares
  for select using (student_id = auth.uid());

create policy "ashares: teacher reads own as recipient" on assignment_shares
  for select using (teacher_id = auth.uid());

create policy "ashares: admin reads org" on assignment_shares
  for select using (auth_role() = 'admin' and check_assignment_in_auth_org(assignment_id));

create policy "ashares: write service role only" on assignment_shares
  for all using (false);

-- ── 6. Новые ADD-политики на существующих таблицах (существующие не трогаем) ──

-- attempts: получатель видит попытки этого assignment, только submitted/checked.
create policy "attempts: teacher read via share" on attempts
  for select using (
    auth_role() = 'teacher' and check_assignment_shared_with_auth(assignment_id)
    and status in ('submitted', 'checked')
  );

-- attempt_task_answers: то же через attempt_id.
create policy "attempt_answers: teacher read via share" on attempt_task_answers
  for select using (
    auth_role() = 'teacher' and check_attempt_shared_with_auth(attempt_id)
  );

-- student_final_results: получатель видит накопительный итог по assignment.
create policy "sfr: teacher reads via share" on student_final_results
  for select using (
    auth_role() = 'teacher' and check_assignment_shared_with_auth(assignment_id)
  );

-- task_answer_keys: получатель видит эталон только по задачам расшаренного assignment.
create policy "task_answer_keys: teacher read via share" on task_answer_keys
  for select using (auth_role() = 'teacher' and check_task_shared_with_auth(task_id));
