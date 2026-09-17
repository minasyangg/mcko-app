-- Иерархия тем программы (roadmap_topics): раньше плоский список, теперь
-- дерево произвольной глубины через parent_id — по образцу book_sections
-- (013), тот же приём (on delete cascade + сбор поддерева BFS в API).
--
-- Зачем: проект перешёл на разметку ДЗ по подтемам кодификатора вплотную —
-- учителю нужно видеть и редактировать не только «Глава», но и «Подтема» и
-- «Деталь внутри подтемы» одной иерархией, а не тремя изолированными
-- плоскими списками. См. project_homework_agent, 2026-09-18.
alter table roadmap_topics
  add column if not exists parent_id uuid references roadmap_topics(id) on delete cascade;

create index if not exists idx_roadmap_topics_parent on roadmap_topics(parent_id);

comment on column roadmap_topics.parent_id is
  'Родительская тема — дерево произвольной глубины (глава → подтема → деталь), NULL у корневых тем. on delete cascade: удаление родителя удаляет детей на уровне БД, но API (DELETE .../topics/[topicId]) сначала обязан проверить submitted-попытки по всему поддереву и отказать, если они есть — БД сама этого не гарантирует.';
