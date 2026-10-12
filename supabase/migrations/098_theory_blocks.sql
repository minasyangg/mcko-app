-- 098: модуль «Теория» — выжимка теории к ДЗ/тесту отдельной сущностью.
--
-- Курс «Вероятность и статистика» 8 кл. проходится самостоятельно: ученик
-- читает теорию урока и решает ДЗ на сайте. Раньше теорию можно было положить
-- только внутрь задания (prompt_html), и она смешивалась с проверяемыми
-- заданиями. Теперь теория — свой блок рядом с заданиями.
--
-- Отдельная таблица + таблица связей, а не колонка у test_versions: блок
-- живёт сам по себе и подключается к тестам. Это задел на доработки —
-- один блок на несколько ДЗ одного урока, привязка к теме программы и к
-- параграфам книги — без переделки схемы. Теория не версионируется вместе с
-- заданиями: правка опечатки в теории не требует новой версии теста.

create table if not exists public.theory_blocks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title           text not null default 'Теория',
  content_md      text not null default '',
  -- «Учебник, ч. 1, §1–10, с. 5–46» — откуда выжимка, чтобы перечитать полностью
  source_ref      text,
  -- книга-источник (задел: переход «читать параграф» из теории)
  book_id         uuid references public.books(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists theory_blocks_org_idx on public.theory_blocks (organization_id);

create table if not exists public.test_theory_blocks (
  test_id         uuid not null references public.tests(id) on delete cascade,
  theory_block_id uuid not null references public.theory_blocks(id) on delete cascade,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  primary key (test_id, theory_block_id)
);

create index if not exists test_theory_blocks_block_idx on public.test_theory_blocks (theory_block_id);

alter table public.theory_blocks enable row level security;
alter table public.test_theory_blocks enable row level security;

-- Чтение. Запись — только service role из API-роутов (/api/tests/[id]/theory),
-- где проверяется владелец теста, как у PATCH /api/tests/[id]; политик на
-- INSERT/UPDATE/DELETE нет намеренно.

-- Учитель и админ видят теорию своей организации (задел на переиспользование
-- блоков между тестами разных учителей одной школы).
create policy "theory_blocks: staff read org" on public.theory_blocks
  for select using (
    (select auth_role()) in ('teacher', 'admin')
    and organization_id = (select auth_org())
  );

create policy "test_theory_blocks: staff read org" on public.test_theory_blocks
  for select using (
    (select auth_role()) in ('teacher', 'admin')
    and exists (
      select 1 from public.tests t
      where t.id = test_theory_blocks.test_id
        and t.organization_id = (select auth_org())
    )
  );

-- Ученик видит теорию только тех тестов, которые ему назначены — тем же
-- правилом, что и сам тест (student_has_test_assignment, включая правило
-- позднего вступления в группу).
create policy "test_theory_blocks: student read assigned" on public.test_theory_blocks
  for select using (
    (select auth_role()) = 'student'
    and public.student_has_test_assignment(test_id)
  );

create policy "theory_blocks: student read assigned" on public.theory_blocks
  for select using (
    (select auth_role()) = 'student'
    and exists (
      select 1 from public.test_theory_blocks ttb
      where ttb.theory_block_id = theory_blocks.id
        and public.student_has_test_assignment(ttb.test_id)
    )
  );

comment on table public.theory_blocks is
  'Блок теории (markdown + KaTeX) к ДЗ/тесту. Подключается к тестам через test_theory_blocks.';
comment on table public.test_theory_blocks is
  'Связь тест ↔ блок теории с порядком показа. Один блок может быть подключён к нескольким тестам.';
