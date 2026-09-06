-- Явный признак «учитель проверил эту попытку вручную» — отдельно от
-- attempts.checked_at, который ставится и при чистой авто-проверке
-- (lib/grading/finalize.ts: allAutoChecked), когда учитель работу вообще не
-- открывал.
--
-- Зачем разделять: таб «На проверке» в мониторинге намеренно показывает и
-- «checked» попытки тоже — это подстраховка от ошибочной 100%-автопроверки,
-- которую иначе никто не увидит (см. MonitorTable). Но как только учитель
-- САМ открыл попытку и сохранил оценку (PATCH /api/attempts/[id]/grade,
-- finalize=true), пересматривать нечего — подстраховка своё отработала,
-- и работа должна уйти в «Проверено», даже если у ученика остались попытки
-- (см. случай Власенко Глеба: 1 из 2 использована, но учитель уже проверил).
alter table attempts add column if not exists teacher_reviewed_at timestamptz;

comment on column attempts.teacher_reviewed_at is
  'Момент ручной проверки учителем (PATCH /api/attempts/[id]/grade, finalize=true). NULL — попытка либо не проверялась, либо проверена только автоматически (lib/grading/finalize.ts) без участия учителя.';

-- Backfill: на момент добавления колонки уже проверено 70 попыток, из них 61
-- отмечена учителем вручную (грейд-роут пишет teacher_checked_at в ответы) —
-- без бэкфилла все они остались бы висеть в «На проверке» до следующего
-- пересохранения оценки. Признак ручной проверки — attempt_task_answers,
-- потому что раньше факт «проверял учитель» нигде в самой attempts не хранился.
update attempts a
set teacher_reviewed_at = coalesce(a.checked_at, now())
where a.status = 'checked'
  and a.teacher_reviewed_at is null
  and exists (
    select 1 from attempt_task_answers ans
    where ans.attempt_id = a.id and ans.teacher_checked_at is not null
  );
