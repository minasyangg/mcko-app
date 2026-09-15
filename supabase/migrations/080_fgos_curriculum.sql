-- Календарно-тематическое планирование (КТП) по ФГОС: что и в каком классе/
-- уровне/порядке проходится по предмету. Источник — официальные рабочие
-- программы, загружаемые пользователем (см. project_homework_agent).
--
-- Нужно агенту автосборки ДЗ, чтобы отличать «тема прошлого класса, к
-- которой ученик не вернулся — пробел» от «тема ещё впереди по программе».
-- roadmap_topics.status ('planned'/'current'/'done') учитель отмечает вручную
-- на сайте — этот файл только даёт список тем/порядок/часы, дата фактического
-- прохождения не выводится автоматически из КТП-документа (в реальных
-- файлах колонка «Дата по факту» остаётся пустой).
create table if not exists fgos_curriculum (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  grade text not null,
  level text not null default 'base' check (level in ('base','advanced')),
  sort_order int not null,
  title text not null,                 -- формулировка темы/раздела как в КТП
  parent_id uuid references fgos_curriculum(id) on delete cascade,
  hours int,                           -- часов по программе
  library_topic_id uuid references library_topics(id) on delete set null,
  fipi_code text,
  source text,                         -- откуда загружен КТП (файл/автор), для аудита
  created_at timestamptz not null default now()
);

create index if not exists idx_fgos_lookup on fgos_curriculum (subject, grade, level, sort_order);
create index if not exists idx_fgos_parent on fgos_curriculum (parent_id);
create index if not exists idx_fgos_topic on fgos_curriculum (library_topic_id);

comment on table fgos_curriculum is
  'КТП/ФГОС: разделы и темы по предмету/классу/уровню в порядке прохождения. Источник для разворачивания roadmap_topics и для диагностики «пробел за прошлый класс / тема ещё впереди». См. project_homework_agent.';

alter table fgos_curriculum enable row level security;

create policy "fgos_curriculum: read for staff" on fgos_curriculum
  for select using (auth_role() = any (array['teacher', 'admin']));

create policy "fgos_curriculum: write service role only" on fgos_curriculum
  for all using (false);

-- Привязка тем программы к разделу КТП/кодификатору + статус прохождения,
-- которым учитель управляет вручную (клик «сейчас здесь» в карточке
-- программы). Дефолт 'planned' не ломает существующие темы программ.
alter table roadmap_topics
  add column if not exists library_topic_id uuid references library_topics(id) on delete set null,
  add column if not exists fgos_curriculum_id uuid references fgos_curriculum(id) on delete set null,
  add column if not exists status text not null default 'planned'
    check (status in ('planned','current','done'));

create index if not exists idx_roadmap_topics_status on roadmap_topics (roadmap_id, status);
