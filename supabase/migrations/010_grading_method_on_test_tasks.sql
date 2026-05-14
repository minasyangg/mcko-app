-- 010_grading_method_on_test_tasks.sql
-- Move grading_method to test_tasks so it can be saved independently
-- of whether a correct_answer exists in task_answer_keys.
-- Required for future AI agent pre-checking: agent needs grading_method
-- even for tasks that don't have a reference answer.

alter table test_tasks
  add column if not exists grading_method text not null default 'exact'
  check (grading_method in (
    'exact','normalized','numeric_tolerance',
    'set_match','contains','regex','manual'
  ));

-- Copy existing values from task_answer_keys into test_tasks
update test_tasks tt
set grading_method = tak.grading_method
from task_answer_keys tak
where tak.task_id = tt.id;

-- Make correct_answer nullable: tasks can have a grading method without
-- a specific reference answer (e.g. manual grading, AI-based evaluation)
alter table task_answer_keys
  alter column correct_answer drop not null;
