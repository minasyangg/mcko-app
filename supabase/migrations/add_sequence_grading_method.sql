-- add_sequence_grading_method
-- Recorded as applied in the live DB (2026-05-17) but never committed as a file.
-- Corresponds to commit d6ec2be "fix: answer grading — strip trailing periods, units, alternatives, sequence".

-- Add 'sequence' grading method for matching tasks (А→3,Б→1,В→2 = "312")
ALTER TABLE test_tasks
  DROP CONSTRAINT IF EXISTS test_tasks_grading_method_check;
ALTER TABLE test_tasks
  ADD CONSTRAINT test_tasks_grading_method_check
  CHECK (grading_method IN (
    'exact','normalized','numeric_tolerance',
    'set_match','contains','regex','manual','sequence'
  ));

-- Same for task_answer_keys (the grading_method column there)
ALTER TABLE task_answer_keys
  DROP CONSTRAINT IF EXISTS task_answer_keys_grading_method_check;
ALTER TABLE task_answer_keys
  ADD CONSTRAINT task_answer_keys_grading_method_check
  CHECK (grading_method IN (
    'exact','normalized','numeric_tolerance',
    'set_match','contains','regex','manual','sequence'
  ));
