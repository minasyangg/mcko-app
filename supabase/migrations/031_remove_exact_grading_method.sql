-- Убираем 'exact' как отдельный метод проверки: в lib/grading/checker.ts он
-- был побайтово идентичен 'normalized' (оба нормализуют текст — регистр,
-- пробелы, запятая→точка, обрезка пунктуации — и сравнивают), реальной
-- разницы в строгости не было. Оставляем только 'normalized'.

update test_tasks set grading_method = 'normalized' where grading_method = 'exact';
update task_answer_keys set grading_method = 'normalized' where grading_method = 'exact';
update library_problems set grading_method = 'normalized' where grading_method = 'exact';
update book_problems set grading_method = 'normalized' where grading_method = 'exact';

alter table test_tasks alter column grading_method set default 'normalized';
alter table task_answer_keys alter column grading_method set default 'normalized';
alter table library_problems alter column grading_method set default 'normalized';
-- book_problems.grading_method уже default 'manual' — не трогаем

alter table test_tasks drop constraint test_tasks_grading_method_check;
alter table test_tasks add constraint test_tasks_grading_method_check
  check (grading_method in ('normalized','numeric_tolerance','set_match','contains','regex','manual','sequence'));

alter table task_answer_keys drop constraint task_answer_keys_grading_method_check;
alter table task_answer_keys add constraint task_answer_keys_grading_method_check
  check (grading_method in ('normalized','numeric_tolerance','set_match','contains','regex','manual','sequence'));

alter table library_problems drop constraint library_problems_grading_method_check;
alter table library_problems add constraint library_problems_grading_method_check
  check (grading_method in ('normalized','numeric_tolerance','set_match','contains','regex','manual'));

alter table book_problems drop constraint book_problems_grading_method_check;
alter table book_problems add constraint book_problems_grading_method_check
  check (grading_method in ('normalized','numeric_tolerance','set_match','contains','regex','manual','sequence'));
