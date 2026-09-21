-- Видимость темы программы у ученика ("глазик" в RoadmapEditor) — учитель
-- может временно скрыть тему (и всё её поддерево) из "Программы" в кабинете
-- ученика, не удаляя её и не отвязывая задания. Эффективная видимость в
-- запросе ученика — AND всех предков по цепочке parent_id: скрытие родителя
-- прячет и все подтемы, даже если у них самих visible_to_students=true.
alter table roadmap_topics
  add column if not exists visible_to_students boolean not null default true;

comment on column roadmap_topics.visible_to_students is
  'Учитель может скрыть тему (и её поддерево) из кабинета ученика без удаления. Эффективная видимость листа — AND всех предков.';
