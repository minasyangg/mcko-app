-- 112: дополнительные попытки сверх исходного лимита назначения.
--
-- Учитель может добавить попытки уже после выдачи задания
-- (POST /api/assignments/[id]/attempts). Лимит assignments.max_attempts
-- растёт для всех адресатов, а срок сдачи ends_at не переписывается: он
-- остаётся фактом исходного задания. Чтобы аналитика отличала работу в
-- добавленную попытку от обычной сдачи после срока, храним:
--   • assignments.extra_attempts — сколько попыток добавлено сверх исходного
--     лимита; исходный лимит = max_attempts - extra_attempts;
--   • attempts.is_extra_attempt — попытка по счёту превышает исходный лимит.
--     Заполняется один раз в finalizeAttempt() при сдаче, как submitted_late (096).
alter table public.assignments
  add column if not exists extra_attempts integer not null default 0
    check (extra_attempts >= 0);

comment on column public.assignments.extra_attempts is
  'Сколько попыток учитель добавил сверх исходного лимита. Исходный лимит = max_attempts - extra_attempts. Дедлайн ends_at при этом не меняется.';

alter table public.attempts
  add column if not exists is_extra_attempt boolean not null default false;

comment on column public.attempts.is_extra_attempt is
  'true — попытка сверх исходного лимита назначения (добавлена учителем). В аналитике — «решено в доп. попытку», а не опоздание, даже если submitted_late = true. Заполняется один раз в finalizeAttempt().';
