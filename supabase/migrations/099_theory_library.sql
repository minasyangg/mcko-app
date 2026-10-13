-- 099: теория как самостоятельные элементы библиотеки.
--
-- В 098 блок теории уже жил отдельно от заданий (theory_blocks +
-- test_theory_blocks), но создавался только со страницы ДЗ и найти его потом
-- было негде. Теперь у блока есть каталожные поля — предмет, класс, теги,
-- краткое описание — и раздел «Библиотека → Теория» с фильтрами, откуда блок
-- подключается к любому ДЗ. Удаление блока из библиотеки снимает его со всех
-- ДЗ (on delete cascade в test_theory_blocks), отключение от ДЗ блок не
-- удаляет — он остаётся в библиотеке.

alter table public.theory_blocks
  add column if not exists subject text,
  add column if not exists grade   text,
  -- ключевые темы для фильтра: «медиана», «диаграммы», «повторение 7 кл.»;
  -- хранятся в нижнем регистре (нормализует API), чтобы фильтр не делил
  -- «Медиана» и «медиана» на два тега
  add column if not exists tags    text[] not null default '{}',
  -- одна-две строки для карточки в библиотеке; если пусто — карточка
  -- показывает начало текста
  add column if not exists summary text;

create index if not exists theory_blocks_catalog_idx on public.theory_blocks (organization_id, subject, grade);
create index if not exists theory_blocks_tags_idx on public.theory_blocks using gin (tags);

-- Каталожные поля для блока модуля 1 курса ВиС-8 (единственный блок на момент миграции)
update public.theory_blocks
set subject = 'Вероятность и статистика',
    grade   = '8',
    tags    = array['повторение 7 класса', 'таблицы', 'диаграммы', 'среднее арифметическое', 'медиана', 'размах', 'описательная статистика'],
    summary = 'Таблицы и диаграммы (столбиковая, круговая), среднее арифметическое и его свойства, медиана и устойчивость к выбросам, наибольшее/наименьшее значения и размах.'
where id = 'bf01a3a1-fd2d-44e5-89aa-fb42708abc9e' and subject is null;

comment on column public.theory_blocks.tags is
  'Ключевые темы для фильтра библиотеки, в нижнем регистре.';
