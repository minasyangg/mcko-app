-- group_id связывает пару строк одного события (уведомление ученику +
-- уведомление его родителю по тому же назначению/проверке) — журнал
-- /teacher/notifications группирует по нему, чтобы показать одну запись с
-- иконками обоих реальных получателей вместо двух неотличимых строк с
-- одинаковым ФИО ученика в колонке "Кому".
-- NULL — для старых строк (до этой миграции) и для событий без родителя
-- вовсе (notifyUsers без groupIdByUser, напр. уведомление учителю).
alter table notification_log add column if not exists group_id uuid;

create index if not exists idx_notification_log_group_id
  on notification_log (group_id) where group_id is not null;
