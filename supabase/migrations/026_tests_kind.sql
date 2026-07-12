-- Разделение раздела на «Тесты» и «Домашние задания».
-- kind='test' — тест с типом/разбаловкой/критериями по правилам (scoring rules);
-- kind='homework' — домашнее задание: баллы задаёт сам учитель при составлении/
-- назначении. Механика прохождения/проверки общая, kind — маркер для UI и
-- дефолт типа при привязке к теме программы.
alter table tests add column if not exists kind text not null default 'test'
  check (kind in ('test','homework'));

create index if not exists idx_tests_kind on tests(kind);
