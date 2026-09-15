-- Учебник может охватывать НЕСКОЛЬКО классов сразу (Атанасян «Геометрия.
-- 7-9 классы» — одна книга, главы I-V = 7 класс, VI-IX = 8 класс,
-- X-XV = 9 класс), а books.grade — одно значение на всю книгу. По решению
-- пользователя книга остаётся ОДНОЙ записью в books, класс проставляется
-- на уровне раздела/задачи — тогда можно фильтровать по классу внутри
-- одной книги, не дробя её на три отдельные записи и не разрывая общее
-- оглавление/предметный указатель/ответы.
--
-- Денормализация: grade хранится и в book_sections (откуда его назначает
-- импортёр по номеру главы), и в book_problems (копия от секции, чтобы
-- фильтр списка заданий по классу не требовал JOIN на каждый запрос
-- читалки/поиска). Обе колонки nullable — книги с одним классом на всю
-- книгу (уже импортированные) их не используют вовсе, books.grade
-- по-прежнему источник истины для них.
alter table book_sections add column if not exists grade text;
alter table book_problems add column if not exists grade text;

create index if not exists book_sections_book_grade_idx on book_sections (book_id, grade);
create index if not exists book_problems_book_grade_idx on book_problems (book_id, grade);

-- Предметный указатель книги («Алфавит 224», «Гипотенуза 70») — семантическое
-- ядро для поиска задач по теме, не отдельный текстовый блок читалки.
-- term       — заголовок словарной статьи как напечатан в книге (без
--              подчинённых уточнений через «—», они схлопнуты в один term
--              построчно — см. импортёр);
-- printed_pages — все номера страниц, напечатанные у термина (термин может
--              встречаться в нескольких местах книги, «Измерение высоты
--              предмета 177, 280»);
-- book_section_id — резолв printed_pages[0] в раздел книги через
--              book_sections.page_start/page_end (первая подходящая
--              страница; остальные printed_pages не резолвятся отдельно —
--              для перехода «термин → куда искать задачи» достаточно
--              одной входной точки, не всех вхождений термина по книге);
-- search_vector — full-text по термину (russian) для нечёткого поиска
--              агентом («движение фигур» → «Движение», «Преобразование…»).
create table if not exists book_index_terms (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  term text not null,
  printed_pages integer[] not null default '{}',
  book_section_id uuid references book_sections(id) on delete set null,
  sort_order integer not null default 0,
  search_vector tsvector generated always as (to_tsvector('russian', term)) stored,
  created_at timestamptz not null default now()
);

create index if not exists book_index_terms_book_id_idx on book_index_terms (book_id);
create index if not exists book_index_terms_search_vector_idx on book_index_terms using gin (search_vector);

alter table book_index_terms enable row level security;

-- Тот же паттерн доступа, что у остальных book_* таблиц (book_pages/
-- book_problems/book_sections): читают teacher/admin своей организации
-- ИЛИ книги без organization_id (общие книги), пишет только сервер
-- (импортёр использует service_role, обходит RLS) — с фронта термины
-- указателя не редактируют.
create policy "book_index_terms: read via book" on book_index_terms
  for select using (
    auth_role() = any (array['teacher', 'admin'])
    and book_id in (
      select books.id from books
      where books.organization_id is null or books.organization_id = auth_org()
    )
  );

create policy "book_index_terms: write service role only" on book_index_terms
  for all using (false);
