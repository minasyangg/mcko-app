-- Аудит библиотеки задач ОГЭ-физика: слияние тем-дублей.
-- Библиотека собрана из двух источников парсинга (fipi.ru + sdamgia) с
-- разной внутренней нумерацией одного и того же кодификатора — часть тем
-- по факту описывает один и тот же элемент содержания под двумя разными
-- library_topics.id, и задачи по нему были раскиданы по обоим. Учитель,
-- выбирающий задачи по теме в фильтре библиотеки, не мог этого заметить и
-- находил только половину задач под одним из двух пунктов списка.
--
-- Перенос — по canonical_topic_id (реальная привязка, которую использует
-- фильтр и add-to-test), не по topic_id (исходная разметка парсера, uже не
-- участвует в фильтрации и оставлена как есть). Дубль не удаляется физически
-- (на него могут ссылаться старые library_problems.topic_id) — только
-- снимается is_canonical, чтобы фильтр его больше не показывал.
--
-- Что уже проверено вручную перед этой миграцией:
--   - все переносимые задачи активны (is_active) и принадлежат canonical_topic_id дубля;
--   - после переноса ни одна is_canonical=false тема не содержит задач;
--   - основная тема пары выбрана по бОльшему числу задач и точности
--     совпадения формулировки с действующим кодификатором ФИПИ 2026.

begin;

-- 1.24 → 1.23 (Механические колебания. Амплитуда, период и частота)
update library_problems set canonical_topic_id = '124c78a4-8577-4c6f-8a52-1fbeecf9b9b4'
  where canonical_topic_id = '89e0716a-8b04-4062-b527-d0276a0ecd5c';
update library_topics set is_canonical = false where id = '89e0716a-8b04-4062-b527-d0276a0ecd5c';

-- 3.21 → 3.16 (Закон отражения света. Плоское зеркало)
update library_problems set canonical_topic_id = 'e2b68541-2a30-4b90-9df0-622d5e60b28e'
  where canonical_topic_id = '4b2ac28c-18ac-4112-bdd6-ea5eae72dc26';
update library_topics set is_canonical = false where id = '4b2ac28c-18ac-4112-bdd6-ea5eae72dc26';

-- 3.22 → 3.17 (Преломление света)
update library_problems set canonical_topic_id = '4413a1bb-90ce-4041-8f96-35265201d9cb'
  where canonical_topic_id = '49869cf7-5b64-4982-8b3a-fb2c4447adb0';
update library_topics set is_canonical = false where id = '49869cf7-5b64-4982-8b3a-fb2c4447adb0';

-- 3.23 → 3.18 (Дисперсия света)
update library_problems set canonical_topic_id = 'a8ef2f9b-4784-4b73-9045-67ecbe24d2e1'
  where canonical_topic_id = 'fcaa86db-4039-4c6a-9cd8-7622c2a31ad6';
update library_topics set is_canonical = false where id = 'fcaa86db-4039-4c6a-9cd8-7622c2a31ad6';

-- 3.19 → 3.24 (Линза. Ход лучей, фокусное расстояние, оптическая сила) —
-- 3.24 выбран основным: больше задач и формулировка ближе к действующему коду
update library_problems set canonical_topic_id = 'b80332b4-3806-4402-8edf-b8a237c74329'
  where canonical_topic_id = 'c2a8a580-34f6-4050-815c-83d4936551ea';
update library_topics set is_canonical = false where id = 'c2a8a580-34f6-4050-815c-83d4936551ea';

-- 3.25 → 3.20 (Глаз как оптическая система. Оптические приборы)
update library_problems set canonical_topic_id = 'cf5e6bbd-52a9-4929-88ae-2106eb33706c'
  where canonical_topic_id = '6c4dfee7-7016-458a-b97a-2d3ba58d6931';
update library_topics set is_canonical = false where id = '6c4dfee7-7016-458a-b97a-2d3ba58d6931';

-- 2.12 → 2.10 (Плавление и кристаллизация. Удельная теплота плавления)
update library_problems set canonical_topic_id = 'e89b284c-36ec-43e3-94a8-317e48ceea10'
  where canonical_topic_id = 'e11481ba-5284-4d01-aad7-0422f61137e1';
update library_topics set is_canonical = false where id = 'e11481ba-5284-4d01-aad7-0422f61137e1';

commit;
