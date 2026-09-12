-- Переразметка кодов раздела 1 «Механические явления» (ОГЭ-физика) под
-- официальный кодификатор ФИПИ-2026 (сверено с PDF fipi.ru). База
-- унаследовала более старую нумерацию: начиная с позиции 8 коды были
-- сдвинуты на -1 относительно официальных, потому что в базе не было
-- отдельной темы для официального 1.11 «Третий закон Ньютона» — а дальше,
-- ближе к концу раздела, отсутствие ещё трёх официальных тем (маятники,
-- резонанс, механические волны) случайно "выравнивало" номер обратно, из-за
-- чего сдвиг был не сразу заметен.
--
-- Заодно найден ещё один скрытый смысловой дубль (в дополнение к 7 парам
-- из миграции 063): "1.9 Второй закон Ньютона" (24 задачи) и "1.10 Второй
-- закон Ньютона. Сонаправленность..." (5 задач) — одна и та же официальная
-- тема 1.10 под двумя формулировками. Слиты по той же схеме.
--
-- constraint UNIQUE(exam_type, subject, fipicod) не deferrable — поэтому
-- переразметка идёт в два прохода: сначала все меняемые коды уводятся на
-- временные значения с префиксом "Z-" (не пересекаются ни с одним реальным
-- кодом), затем расставляются на итоговые официальные номера. Так исключены
-- коллизии на любом шаге, независимо от порядка обновления строк.

begin;

-- Зачистка "мёртвых" кодов: миграция 063 депризнала темы-дубли (is_canonical
-- = false), но не трогала их fipicod — эти коды физически заняты и мешают
-- Проходу 2 ниже (например "1.24" ещё числится за депризнанным дублем
-- "Механические колебания..." из 063, и назначить тот же код действующей
-- теме 1.23→1.24 без этой зачистки нельзя — тот же UNIQUE constraint).
update library_topics set fipicod = null
where subject='Физика' and exam_type='ОГЭ' and is_canonical=false and fipicod = '1.24';

-- ── Слияние дубля: "1.9 Второй закон Ньютона" (более полная база задач)
--    ← "1.10 Второй закон Ньютона. Сонаправленность..." (уже) ─────────────
update library_problems set canonical_topic_id = '83907583-aadf-4d91-94c6-ec118d795543' -- 1.9, 24 задачи
  where canonical_topic_id = 'd681a177-4de4-488d-a486-5d87918b5141'; -- 1.10, 5 задач
-- fipicod дубля уводим сразу (не просто is_canonical=false) — иначе он
-- держит '1.10' и Прохода 2 упирается в тот же UNIQUE constraint, потому что
-- "1.9 Второй закон Ньютона" переезжает именно на код '1.10'.
update library_topics set is_canonical = false, fipicod = null where id = 'd681a177-4de4-488d-a486-5d87918b5141';

-- ── Проход 1: временные коды (избегаем коллизий с UNIQUE constraint) ─────
update library_topics set fipicod = 'Z-1.2'  where id = '43ea212d-b42d-4446-aa28-d270b59277c4'; -- было 1.2  Равномерное прямолинейное движение
update library_topics set fipicod = 'Z-1.3'  where id = '06b2589e-1b58-4409-a5b7-1b9263418b12'; -- было 1.3  Равноускоренное движение
update library_topics set fipicod = 'Z-1.4'  where id = 'e402ac5a-f637-4e56-8e16-b6d0ecc9b4af'; -- было 1.4  Свободное падение
update library_topics set fipicod = 'Z-1.5'  where id = 'e654d143-e0ff-49b8-b799-c201bba7d0a4'; -- было 1.5  Равномерное по окружности
update library_topics set fipicod = 'Z-1.6'  where id = '02106a52-23c2-42ba-8845-155c01f201a9'; -- было 1.6  Масса. Плотность
update library_topics set fipicod = 'Z-1.7'  where id = 'c383fe65-2c2d-4481-a354-fc767bfa0884'; -- было 1.7  Сила — векторная величина
update library_topics set fipicod = 'Z-1.8'  where id = 'd506bd85-d278-43d7-af20-9d7bc54aedee'; -- было 1.8  Явление инерции, 1-й закон
update library_topics set fipicod = 'Z-1.9'  where id = '83907583-aadf-4d91-94c6-ec118d795543'; -- было 1.9  Второй закон Ньютона (после слияния)
update library_topics set fipicod = 'Z-1.11' where id = '402e5be3-72a1-4dc6-b407-b8a86ba525a9'; -- было 1.11 Трение покоя и скольжения
update library_topics set fipicod = 'Z-1.12' where id = 'df4a9c5c-cdad-42f0-8e72-982a46259826'; -- было 1.12 Деформация, закон Гука
update library_topics set fipicod = 'Z-1.13' where id = '2aeac2a0-2717-4d22-b7d4-7773ab213275'; -- было 1.13 Всемирное тяготение
update library_topics set fipicod = 'Z-1.14' where id = 'f4545264-1171-4c5a-96a7-fc79ec9ad4ff'; -- было 1.14 Импульс тела
update library_topics set fipicod = 'Z-1.15' where id = '1401f1cb-54c2-480d-8e68-dda9cdbbbb0d'; -- было 1.15 ЗСИ
update library_topics set fipicod = 'Z-1.16' where id = 'feef7243-2211-4717-a424-273d48ddf1bf'; -- было 1.16 Мех. работа, мощность
update library_topics set fipicod = 'Z-1.17' where id = '2a3607a2-db5c-4803-8ebc-fc0b92895818'; -- было 1.17 Кинетическая/потенциальная энергия
update library_topics set fipicod = 'Z-1.18' where id = '3390226a-e910-4adf-998d-b431f2968a35'; -- было 1.18 Мех. энергия, ЗСЭ
update library_topics set fipicod = 'Z-1.19' where id = '019de4c4-bf90-4f96-9b11-1ccfa6cbad58'; -- было 1.19 Простые механизмы
update library_topics set fipicod = 'Z-1.20' where id = 'af979ff3-844a-42bd-94e8-065a1c912d2b'; -- было 1.20 Гидростатическое давление
update library_topics set fipicod = 'Z-1.21' where id = 'cdab91e8-2f44-40bb-9f68-c8570c076d4c'; -- было 1.21 Закон Паскаля
update library_topics set fipicod = 'Z-1.22' where id = '735e8e2d-5883-4d1e-a017-e7174c79f9a6'; -- было 1.22 Закон Архимеда
update library_topics set fipicod = 'Z-1.23' where id = '124c78a4-8577-4c6f-8a52-1fbeecf9b9b4'; -- было 1.23 Механические колебания

-- ── Проход 2: временные → итоговые официальные коды ──────────────────────
update library_topics set fipicod = '1.3'  where fipicod = 'Z-1.2';
update library_topics set fipicod = '1.4'  where fipicod = 'Z-1.3';
update library_topics set fipicod = '1.5'  where fipicod = 'Z-1.4';
update library_topics set fipicod = '1.6'  where fipicod = 'Z-1.5';
update library_topics set fipicod = '1.7'  where fipicod = 'Z-1.6';
update library_topics set fipicod = '1.8'  where fipicod = 'Z-1.7';
update library_topics set fipicod = '1.9'  where fipicod = 'Z-1.8';
update library_topics set fipicod = '1.10' where fipicod = 'Z-1.9';
update library_topics set fipicod = '1.12' where fipicod = 'Z-1.11';
update library_topics set fipicod = '1.13' where fipicod = 'Z-1.12';
update library_topics set fipicod = '1.14' where fipicod = 'Z-1.13';
update library_topics set fipicod = '1.15' where fipicod = 'Z-1.14';
update library_topics set fipicod = '1.16' where fipicod = 'Z-1.15';
update library_topics set fipicod = '1.17' where fipicod = 'Z-1.16';
update library_topics set fipicod = '1.18' where fipicod = 'Z-1.17';
update library_topics set fipicod = '1.19' where fipicod = 'Z-1.18';
update library_topics set fipicod = '1.20' where fipicod = 'Z-1.19';
update library_topics set fipicod = '1.21' where fipicod = 'Z-1.20';
update library_topics set fipicod = '1.22' where fipicod = 'Z-1.21';
update library_topics set fipicod = '1.23' where fipicod = 'Z-1.22';
update library_topics set fipicod = '1.24' where fipicod = 'Z-1.23';
-- 1.1 и 1.28 не менялись — уже совпадали с официальными кодами.

-- ── Новые пустые темы (элементы содержания 2026 г., которых в библиотеке
--    нет ни под каким кодом — 0 задач, наполнение отдельным этапом) ──────
insert into library_topics (exam_type, subject, grade, name, parent_id, sort_order, is_canonical, fipicod)
select 'ОГЭ', 'Физика', '9', v.name,
  (select id from library_topics where exam_type='ОГЭ' and subject='Физика' and name='Механика' and parent_id is null),
  v.sort_order, true, v.fipicod
from (values
  ('1.2',  'Равномерное и неравномерное движение. Средняя скорость', 1002),
  ('1.11', 'Взаимодействие тел. Третий закон Ньютона', 1011),
  ('1.25', 'Математический и пружинный маятники', 1025),
  ('1.26', 'Затухающие колебания. Вынужденные колебания. Резонанс', 1026),
  ('1.27', 'Механические волны. Продольные и поперечные волны. Длина волны', 1027)
) as v(fipicod, name, sort_order)
where not exists (
  select 1 from library_topics t
  where t.exam_type='ОГЭ' and t.subject='Физика' and t.fipicod = v.fipicod
);

-- ── sort_order = 1000 + номер после точки — паттерн, по которому реально
--    сортируется дерево (не по строковому fipicod). Пересчитываем ВСЕ подтемы
--    раздела 1 заново по итоговому коду: часть тем сдвинула позицию (была
--    1.9 → стала 1.10 и т.п.), и их старый sort_order больше не соответствует
--    новому месту в списке — оставлять было бы сортировкой по старым кодам.
update library_topics t
set sort_order = 1000 + split_part(t.fipicod, '.', 2)::int
where t.exam_type = 'ОГЭ' and t.subject = 'Физика' and t.is_canonical = true
  and t.parent_id = (select id from library_topics where exam_type='ОГЭ' and subject='Физика' and name='Механика' and parent_id is null)
  and t.fipicod ~ '^1\.[0-9]+$';

commit;
