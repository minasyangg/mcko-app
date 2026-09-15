-- Двухфазный флоу автосборки ДЗ (project_homework_agent): агент сначала
-- предлагает ТЕМУ учителю (фаза 1), учитель подтверждает/правит/пропускает,
-- и только после подтверждения собирается само ДЗ (фаза 2). Учитель сказал
-- прямо: «агент сначала сам готовит тему, отправляет учителю в ТГ… Учитель
-- подтверждает либо добавляет от себя ещё либо редактирует и подтверждает».
--
-- unique(roadmap_id, slot_date) — идемпотентность по образцу
-- grade_promotions.school_year (047/048): повторный запуск cron в тот же
-- день на ту же программу упирается в конфликт, а не создаёт дубль.
create table if not exists homework_proposals (
  id uuid primary key default gen_random_uuid(),
  roadmap_id uuid not null references roadmaps(id) on delete cascade,
  rule_id uuid references roadmap_agent_rules(id) on delete set null,
  organization_id uuid not null references organizations(id) on delete cascade,
  teacher_id uuid not null references profiles(id) on delete cascade,
  roadmap_topic_id uuid references roadmap_topics(id) on delete set null,

  -- ── фаза 1: тема ─────────────────────────────────────────────────────
  proposed_title text not null,      -- краткая тема, которую предложил агент
  proposed_summary text,             -- 2-3 строки диагноза: почему именно эта тема
  rationale jsonb not null default '{}'::jsonb, -- машинное обоснование (сигналы A/B/C/D)
  final_title text,                  -- итоговая тема после правки учителя (null = не правил)
  teacher_note text,                 -- «добавь ещё про производную» и т.п.

  status text not null default 'pending' check (status in
    ('pending','confirmed','rejected','expired','building','built','failed')),
  confirmed_at timestamptz,
  confirmed_by uuid references profiles(id) on delete set null,
  expires_at timestamptz not null,

  -- ── фаза 2: результат сборки ─────────────────────────────────────────
  test_id uuid references tests(id) on delete set null,
  assignment_id uuid references assignments(id) on delete set null,
  build_error text,

  -- ── Telegram (кнопки подтверждения, этап 3 плана) ───────────────────
  -- секрет действия: callback_data несёт action_token, не голый id — иначе
  -- знание UUID предложения позволило бы подтвердить чужое ДЗ.
  action_token text not null default encode(gen_random_bytes(16), 'hex'),
  telegram_chat_id bigint,
  telegram_message_id bigint, -- для editMessageText после нажатия кнопки

  slot_date date not null,   -- дата слота расписания — ключ идемпотентности
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (roadmap_id, slot_date)
);

create index if not exists idx_hw_proposals_status on homework_proposals (status, expires_at);
create index if not exists idx_hw_proposals_teacher on homework_proposals (teacher_id, status);
create index if not exists idx_hw_proposals_action_token on homework_proposals (action_token);

comment on table homework_proposals is
  'Двухфазное предложение ДЗ: агент предлагает тему → учитель подтверждает/правит → агент собирает и назначает. См. project_homework_agent.';

-- RLS: учитель видит и правит свои предложения (по teacher_id — не через
-- check_roadmap_owned_by_auth, т.к. предложение адресовано конкретному
-- учителю программы, не «владельцу роадмапа» в общем смысле, хотя на
-- практике сейчас это одно и то же лицо). Admin читает по организации.
-- Пишет (insert/фаза сборки) service_role — cron и callback-обработчик
-- работают через admin-клиент, RLS их не касается.
alter table homework_proposals enable row level security;

create policy "homework_proposals: teacher manage own" on homework_proposals
  for all
  using (auth_role() = 'teacher' and teacher_id = auth.uid())
  with check (auth_role() = 'teacher' and teacher_id = auth.uid());

create policy "homework_proposals: admin read org" on homework_proposals
  for select using (auth_role() = 'admin' and organization_id = auth_org());
