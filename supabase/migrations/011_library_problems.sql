-- Migration 011: Global Problem Library
-- Глобальная библиотека задач (sdamgia + ручные) + шаблоны автосборки тестов

-- ── Темы по ФИПИ кодификатору ────────────────────────────────────────────────
create table library_topics (
  id          uuid primary key default gen_random_uuid(),
  exam_type   text not null,           -- 'ОГЭ' | 'ЕГЭ' | 'ВПР'
  subject     text not null,           -- 'Математика' | 'Физика'
  grade       text,                    -- '9' | '11'
  fipicod     text,                    -- '3.2' (ФИПИ кодификатор)
  name        text not null,           -- 'Целые и дробно-рациональные неравенства'
  description text,
  sort_order  int  default 0,
  parent_id   uuid references library_topics(id) on delete set null,
  created_at  timestamptz default now(),
  unique(exam_type, subject, fipicod) -- один раздел одного экзамена/предмета
);

create index on library_topics(exam_type, subject);
create index on library_topics(parent_id);

-- ── Глобальная библиотека задач ───────────────────────────────────────────────
create table library_problems (
  id          uuid primary key default gen_random_uuid(),

  -- Источник (дедупликация)
  source_type   text not null default 'sdamgia',  -- 'sdamgia' | 'manual'
  source_domain text,                              -- 'math-oge.sdamgia.ru'
  source_id     text,                              -- '311672'
  source_url    text,
  scraped_at    timestamptz,

  -- Категоризация
  exam_type        text not null,   -- 'ОГЭ'
  subject          text not null,   -- 'Математика'
  grade            text,            -- '9'
  topic_id         uuid references library_topics(id) on delete set null,
  task_number_type text,            -- 'Тип 13' (номер типа в экзамене)
  theme_id         int,             -- ID темы на sdamgia (для обновлений)

  -- Контент задачи
  prompt_text  text not null,
  prompt_html  text,
  task_type    text not null default 'short_text'
    check (task_type in ('single_choice','multiple_choice','short_text','numeric','composite','manual_review')),
  options      jsonb default '[]',  -- варианты ответа для single/multiple_choice

  -- Ответ и проверка
  correct_answer    jsonb,
  grading_method    text not null default 'exact'
    check (grading_method in ('exact','normalized','numeric_tolerance','set_match','contains','regex','manual')),
  grading_config    jsonb,
  default_max_score numeric not null default 1,

  -- Решение
  solution_html text,
  solution_text text,

  -- Критерии оценивания
  criteria_html   text,
  criteria_scores jsonb,  -- [{text: "...", score: 2}, ...]

  -- Доступность
  organization_id uuid references organizations(id) on delete cascade,  -- NULL = глобальная
  is_active       boolean default true,

  -- Статистика использования
  used_count int default 0,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Дедупликация по источнику
  unique(source_domain, source_id)
);

create index on library_problems(exam_type, subject, grade);
create index on library_problems(topic_id);
create index on library_problems(source_domain, source_id);
create index on library_problems(organization_id);
create index on library_problems(task_number_type);
create index on library_problems using gin(to_tsvector('russian', prompt_text));

-- ── Изображения задач библиотеки ──────────────────────────────────────────────
create table library_problem_media (
  id                 uuid primary key default gen_random_uuid(),
  library_problem_id uuid not null references library_problems(id) on delete cascade,
  storage_path       text not null,       -- bucket: 'library-media'
  placement          text default 'above_text'
    check (placement in ('above_text','below_text','inline','solution')),
  sort_order         int  default 0,
  alt_text           text,
  width_px           int,
  height_px          int,
  file_size_bytes    int,
  created_at         timestamptz default now(),
  unique(library_problem_id, sort_order)
);

create index on library_problem_media(library_problem_id);

-- ── Шаблоны автосборки тестов ─────────────────────────────────────────────────
create table exam_blueprints (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  exam_type       text not null,
  subject         text not null,
  grade           text,
  description     text,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique(organization_id, name)
);

create index on exam_blueprints(organization_id);

-- Секции шаблона: "взять N задач типа X по теме Y"
create table exam_blueprint_sections (
  id               uuid primary key default gen_random_uuid(),
  blueprint_id     uuid not null references exam_blueprints(id) on delete cascade,
  topic_id         uuid references library_topics(id) on delete set null,
  task_number_type text,            -- фильтр по типу ('Тип 13')
  count            int not null default 1,
  max_score        numeric,         -- переопределить балл (null = из библиотеки)
  sort_order       int default 0
);

create index on exam_blueprint_sections(blueprint_id);

-- ── Связь test_tasks с библиотекой ───────────────────────────────────────────
alter table test_tasks
  add column library_problem_id uuid references library_problems(id) on delete set null;

create index on test_tasks(library_problem_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

-- library_topics: читают все аутентифицированные
alter table library_topics enable row level security;
create policy "library_topics: read for all authenticated"
  on library_topics for select
  using (auth.role() = 'authenticated');
create policy "library_topics: insert/update for service role only"
  on library_topics for all
  using (false);  -- только через admin client (service role)

-- library_problems: читают все аутентифицированные (глобальные) + своей орг
alter table library_problems enable row level security;
create policy "library_problems: read global or own org"
  on library_problems for select
  using (
    auth.role() = 'authenticated'
    and (organization_id is null or organization_id = (
      select organization_id from profiles where id = auth.uid()
    ))
  );
create policy "library_problems: insert/update via service role"
  on library_problems for all
  using (false);

-- library_problem_media: читают все аутентифицированные
alter table library_problem_media enable row level security;
create policy "library_problem_media: read for all authenticated"
  on library_problem_media for select
  using (auth.role() = 'authenticated');
create policy "library_problem_media: write via service role"
  on library_problem_media for all
  using (false);

-- exam_blueprints: только своя орг, учителя
alter table exam_blueprints enable row level security;
create policy "exam_blueprints: teacher own org"
  on exam_blueprints for all
  using (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and (select role from profiles where id = auth.uid()) in ('teacher','admin')
  );

-- exam_blueprint_sections: через blueprint
alter table exam_blueprint_sections enable row level security;
create policy "exam_blueprint_sections: via blueprint org"
  on exam_blueprint_sections for all
  using (
    blueprint_id in (
      select id from exam_blueprints
      where organization_id = (select organization_id from profiles where id = auth.uid())
    )
  );
