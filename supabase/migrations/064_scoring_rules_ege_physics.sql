-- Правило разбалловки ЕГЭ-физика (первичные баллы по номерам заданий).
-- Сверено с официальной спецификацией КИМ ЕГЭ 2026 по физике (fipi.ru):
-- 26 заданий, максимальный первичный балл — 45.
-- Аналогичное правило для ОГЭ-физика уже существовало и сверка подтвердила
-- его точность (39 баллов, 22 задания) — правкам не подвергалось.
insert into scoring_rules (organization_id, name, exam_type, grade, subject)
select '11111111-1111-1111-1111-111111111111', 'ФИЗ - ЕГЭ - Первичные баллы', 'ЕГЭ', '11', 'Физика'
where not exists (
  select 1 from scoring_rules
  where organization_id = '11111111-1111-1111-1111-111111111111'
    and exam_type = 'ЕГЭ' and grade = '11' and subject = 'Физика'
);

insert into scoring_rule_items (rule_id, task_number, max_score)
select r.id, v.task_number, v.max_score
from scoring_rules r
cross join (values
  (1,1),(2,1),(3,1),(4,1),(5,2),(6,2),(7,1),(8,1),(9,2),(10,2),
  (11,1),(12,1),(13,1),(14,2),(15,2),(16,1),(17,2),(18,2),(19,1),(20,1),
  (21,3),(22,2),(23,2),(24,3),(25,3),(26,4)
) as v(task_number, max_score)
where r.organization_id = '11111111-1111-1111-1111-111111111111'
  and r.exam_type = 'ЕГЭ' and r.grade = '11' and r.subject = 'Физика'
on conflict (rule_id, task_number) do nothing;
