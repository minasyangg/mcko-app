-- 'self' переименован в 'student' и добавлена третья роль 'teacher':
-- notifyUsers обслуживает и уведомления ученику («Вам назначено...»), и
-- уведомления учителю («Работа сдана и проверена автоматически...») — обе
-- писались с одинаковым (бывшим) recipient='self', и в /teacher/notifications
-- учительское уведомление тоже показывало иконку "ребёнок" (Baby), хотя
-- получатель — учитель, а не ученик и не родитель (живой случай: строка
-- "Иванова Мария Петровна ... Работа сдана и проверена автоматически
-- Краснова Ярослава" отрендерилась с иконкой ребёнка).
alter table notification_log drop constraint if exists notification_log_recipient_check;

update notification_log set recipient = 'student' where recipient = 'self';

alter table notification_log add constraint notification_log_recipient_check
  check (recipient in ('student', 'parent', 'teacher'));

alter table notification_log alter column recipient set default 'student';

comment on column notification_log.recipient is
  'Кому реально ушло сообщение: student — ученику/пользователю события (user_id), parent — родителю ученика (user_id — профиль ученика, доставка на parent_telegram_chat_id), teacher — учителю (user_id — профиль учителя)';

-- Бэкфилл существующих строк, отправленных учителю (event_type начинается с
-- attempt_ и получатель — не сам ученик попытки, а created_by назначения):
-- по тексту сообщения такие строки узнаются по заголовкам, которых нет у
-- ученических/родительских уведомлений.
update notification_log
set recipient = 'teacher'
where recipient = 'student'
  and (message like '✅ Работа сдана и проверена автоматически%' or message like '📬 Работа ждёт проверки%');
