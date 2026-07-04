-- 016_books_module.sql
-- Модуль «Книги»: интерактивные учебники/задачники как отдельная база заданий
-- (полностью отдельно от экзаменационной library_problems).
-- Импорт выполняется локальным CLI (scripts/book-import.ts), сайт только читает.

-- ── Книги ────────────────────────────────────────────────────────────────────
create table books (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references organizations(id) on delete cascade, -- null = глобальная
  book_type        text not null default 'textbook'
    check (book_type in ('textbook','problem_book','workbook','didactic')),
  title            text not null,          -- 'Алгебра. 7 класс'
  authors          text,                   -- 'Ю. Н. Макарычев, Н. Г. Миндюк, ...'
  publisher        text,
  publication_year int,
  isbn             text,
  subject          text not null,          -- 'Математика' | 'Физика' | ...
  grade            text,                   -- '7'
  level            text,                   -- 'базовый' | 'углублённый'
  description      text,
  cover_image_path text,                   -- storage path обложки (может быть URL)
  page_count       int,
  import_meta      jsonb default '{}',     -- счётчики и предупреждения импорта
  is_active        boolean not null default true,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index on books(subject, grade);
create index on books(organization_id);

-- ── Дерево содержания ────────────────────────────────────────────────────────
create table book_sections (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references books(id) on delete cascade,
  parent_id  uuid references book_sections(id) on delete cascade,
  kind       text not null default 'paragraph'
    check (kind in ('chapter','paragraph','punkt','exercises','extra','other')),
  number     text,                         -- '1', '§ 2', '14'
  title      text not null,
  page_start int,                          -- индекс страницы скана (0-based)
  page_end   int,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create index on book_sections(book_id, sort_order);
create index on book_sections(parent_id);

-- ── Страницы (тело интерактивной читалки) ────────────────────────────────────
create table book_pages (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references books(id) on delete cascade,
  page_index   int not null,               -- порядковый номер в скане (0-based)
  printed_page int,                        -- печатный номер страницы (из OCR-блока number)
  markdown     text not null,              -- полный markdown страницы (теория + задания, LaTeX)
  unique (book_id, page_index)
);

create index on book_pages(book_id, page_index);

-- ── Задания ──────────────────────────────────────────────────────────────────
create table book_problems (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid not null references books(id) on delete cascade,
  section_id       uuid references book_sections(id) on delete set null,
  task_number      text not null,          -- '735' (text: бывают '12.3', '735а')
  task_number_sort int,                    -- числовая часть для сортировки
  page_index       int not null,           -- страница скана, где задание начинается
  md_start         int,                    -- смещение фрагмента в book_pages.markdown
  md_end           int,
  prompt_md        text not null,          -- полный текст задания (включая перенос на след. страницу)
  task_type        text not null default 'short_text'
    check (task_type in ('single_choice','multiple_choice','short_text','numeric','composite','manual_review')),
  grading_method   text not null default 'manual'
    check (grading_method in ('exact','normalized','numeric_tolerance','set_match','contains','regex','manual','sequence')),
  options          jsonb default '[]',
  correct_answer   jsonb,                  -- из раздела «Ответы» книги
  answer_source    text not null default 'none'
    check (answer_source in ('book_answers','manual','ai','none')),
  difficulty       text not null default 'standard'
    check (difficulty in ('standard','advanced')),
  has_images       boolean not null default false,
  is_active        boolean not null default true,
  used_count       int not null default 0,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  unique (book_id, task_number)
);

create index on book_problems(book_id, task_number_sort);
create index on book_problems(section_id);
create index on book_problems using gin (to_tsvector('russian', prompt_md));

-- ── Связь test_tasks с книгами (рядом с library_problem_id) ──────────────────
alter table test_tasks
  add column if not exists book_problem_id uuid references book_problems(id) on delete set null;

create index on test_tasks(book_problem_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Чтение: все аутентифицированные своей организации (или глобальные книги).
-- Запись: только service role (локальный импортёр / серверные роуты).

alter table books enable row level security;
create policy "books: read org or global"
  on books for select
  using (
    auth.role() = 'authenticated'
    and (organization_id is null or organization_id = auth_org())
  );
create policy "books: write service role only"
  on books for all
  using (false);

alter table book_sections enable row level security;
create policy "book_sections: read via book"
  on book_sections for select
  using (
    book_id in (
      select id from books
      where organization_id is null or organization_id = auth_org()
    )
  );
create policy "book_sections: write service role only"
  on book_sections for all
  using (false);

alter table book_pages enable row level security;
create policy "book_pages: read via book"
  on book_pages for select
  using (
    book_id in (
      select id from books
      where organization_id is null or organization_id = auth_org()
    )
  );
create policy "book_pages: write service role only"
  on book_pages for all
  using (false);

alter table book_problems enable row level security;
create policy "book_problems: read via book"
  on book_problems for select
  using (
    book_id in (
      select id from books
      where organization_id is null or organization_id = auth_org()
    )
  );
create policy "book_problems: write service role only"
  on book_problems for all
  using (false);
