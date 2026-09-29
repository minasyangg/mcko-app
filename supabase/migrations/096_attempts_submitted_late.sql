-- 096: факт «сдано после дедлайна» на попытке.
-- Заполняется один раз в lib/grading/finalize.ts при переходе
-- in_progress -> submitted/checked, сравнением submitted_at с
-- assignments.ends_at на момент сдачи. NULL — у назначения не было срока
-- (ends_at is null), сравнивать не с чем; не пересчитывается позже —
-- это факт конкретной сдачи, а не текущее состояние.
alter table public.attempts
  add column submitted_late boolean;

comment on column public.attempts.submitted_late is
  'true — попытка сдана после assignments.ends_at; false — вовремя; null — у назначения не было срока. Заполняется один раз в finalizeAttempt(), не пересчитывается.';
