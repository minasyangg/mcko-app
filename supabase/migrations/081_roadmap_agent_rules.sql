-- Правила автосборки ДЗ для программы (roadmap) — субагент автогенерации ДЗ
-- (project_homework_agent). По образцу scoring_rules (008): правило меняет
-- учитель на сайте, не разработчик кодом — расписание, состав и пропорции
-- ДЗ различаются от программы к программе (пример: «Успех 10-ЕГЭ-Ф» может
-- собирать ДЗ дважды в неделю, другая программа — раз в неделю).
--
-- Одна программа — одно правило (unique на roadmap_id). Учитель, ведущий
-- разные потоки по-разному (например «лёгкое ДЗ по вторникам / контрольное
-- по пятницам»), заводит для этого отдельные roadmap — снятие unique и
-- множественные правила на программу отложены до появления такого запроса.
create table if not exists roadmap_agent_rules (
  id uuid primary key default gen_random_uuid(),
  roadmap_id uuid not null unique references roadmaps(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,

  enabled boolean not null default false, -- выключено по умолчанию: учитель включает осознанно

  -- ── расписание ────────────────────────────────────────────────────────
  -- дни недели ISO: 1=пн … 7=вс, массив (не cron-строка — учителю понятнее
  -- и валидируется на уровне БД). «2 раза в неделю» = '{2,5}'.
  weekdays smallint[] not null default '{2,5}',
  send_at_local time not null default '09:00', -- локальное время предложения темы учителю
  timezone text not null default 'Europe/Moscow',
  due_in_days smallint not null default 3 check (due_in_days between 1 and 30), -- ends_at = starts_at + interval

  -- ── объём и состав ────────────────────────────────────────────────────
  task_count smallint not null default 8 check (task_count between 1 and 40),
  -- доля заданий «на работу над ошибками» (0..100), остальное — по текущей теме
  mistakes_pct smallint not null default 40 check (mistakes_pct between 0 and 100),
  difficulty text not null default 'mixed' check (difficulty in ('standard','advanced','mixed')),
  allow_images boolean not null default false, -- по умолчанию не берём задания с картинками
  require_answer boolean not null default true, -- только задания с проставленным эталоном ответа

  -- ── поведение агента ──────────────────────────────────────────────────
  confirm_timeout_hours smallint not null default 24 check (confirm_timeout_hours between 1 and 168),
  auto_confirm boolean not null default false, -- true: фаза 1 сразу подтверждена, без ожидания учителя
  auto_grant_access boolean not null default true, -- открывать доступ отставшим по правилу 3 дней (058)
  mistakes_lookback_days smallint not null default 30 check (mistakes_lookback_days between 1 and 365),

  notes text, -- заметка учителя агенту, свободный текст — передаётся в диагноз, агентом не парсится

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_roadmap_agent_rules_org on roadmap_agent_rules (organization_id);

comment on table roadmap_agent_rules is
  'Правила автосборки ДЗ по расписанию для программы (roadmap) — субагент автогенерации ДЗ. Учитель настраивает сам. См. project_homework_agent.';

-- Разрешённые источники заданий для автосборки: книги и/или разделы
-- библиотеки (ФИПИ/sdamgia). Строка = «можно брать отсюда, с весом weight».
-- Отсутствие строк для правила = агент не знает, откуда брать задания —
-- обрабатывается в коде сборки как «нет источников», не как «все источники».
create table if not exists roadmap_agent_rule_sources (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references roadmap_agent_rules(id) on delete cascade,
  source_kind text not null check (source_kind in ('book','library_topic','library_exam')),
  book_id uuid references books(id) on delete cascade,
  library_topic_id uuid references library_topics(id) on delete cascade,
  exam_type text, -- для source_kind='library_exam': 'ЕГЭ'/'ОГЭ'
  subject text,
  grade text,
  weight smallint not null default 1 check (weight between 0 and 10),
  target_count smallint, -- целевое число заданий из этого источника; null = пропорционально weight
  created_at timestamptz not null default now(),

  -- ровно одна ссылка на источник соответствует своему kind
  constraint rule_source_shape check (
    (source_kind = 'book'          and book_id is not null and library_topic_id is null)
 or (source_kind = 'library_topic' and library_topic_id is not null and book_id is null)
 or (source_kind = 'library_exam'  and exam_type is not null and book_id is null and library_topic_id is null)
  )
);

create index if not exists idx_rule_sources_rule on roadmap_agent_rule_sources (rule_id);

comment on table roadmap_agent_rule_sources is
  'Разрешённые источники заданий (книги/темы библиотеки/экзамен целиком) для правила roadmap_agent_rules.';

-- RLS: по образцу roadmap_topics/roadmap_source_groups (021/059) —
-- владелец программы, не вся организация. Функции check_roadmap_owned_by_auth
-- / check_roadmap_in_auth_org определены в 021_roadmaps.sql.
alter table roadmap_agent_rules enable row level security;
alter table roadmap_agent_rule_sources enable row level security;

create policy "roadmap_agent_rules: teacher manage own" on roadmap_agent_rules
  for all
  using (auth_role() = 'teacher' and check_roadmap_owned_by_auth(roadmap_id))
  with check (auth_role() = 'teacher' and check_roadmap_owned_by_auth(roadmap_id));

create policy "roadmap_agent_rules: admin read org" on roadmap_agent_rules
  for select using (auth_role() = 'admin' and check_roadmap_in_auth_org(roadmap_id));

create policy "roadmap_agent_rule_sources: teacher manage own" on roadmap_agent_rule_sources
  for all
  using (rule_id in (
    select r.id from roadmap_agent_rules r
    where auth_role() = 'teacher' and check_roadmap_owned_by_auth(r.roadmap_id)
  ))
  with check (rule_id in (
    select r.id from roadmap_agent_rules r
    where auth_role() = 'teacher' and check_roadmap_owned_by_auth(r.roadmap_id)
  ));

create policy "roadmap_agent_rule_sources: admin read org" on roadmap_agent_rule_sources
  for select using (rule_id in (
    select r.id from roadmap_agent_rules r
    where auth_role() = 'admin' and check_roadmap_in_auth_org(r.roadmap_id)
  ));
