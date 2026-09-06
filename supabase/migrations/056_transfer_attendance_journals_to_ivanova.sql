-- Перенос журналов посещаемости от админа к учителю Ивановой М.П.
--
-- Оба существующих журнала («Броско 9-ОГЭ-М», «Броско 9-ОГЭ-Ф») были заведены
-- на аккаунте администратора при первоначальном наполнении, хотя фактически
-- ведёт эти занятия учитель Иванова Мария Петровна. Владение журналом —
-- поле attendance_journals.created_by (миграция 051): именно оно определяет,
-- чей это журнал в интерфейсе (/teacher/attendance показывает журналы своего
-- created_by) и в RLS-политике "attendance_journals: owner or admin".
--
-- Дочерние таблицы (attendance_students/days/marks) владельца не хранят —
-- доступ к ним идёт через check_attendance_journal_access(journal_id), то
-- есть через сам журнал, поэтому их трогать не нужно: как только сменится
-- created_by журнала, все ученики/дни/отметки внутри него автоматически
-- станут видны и редактируемы новым владельцем.
--
-- Админ доступа не теряет: политика оставляет чтение/запись для auth_role() =
-- 'admin' независимо от created_by — перенос только меняет, у кого журнал
-- показывается как «свой» в /teacher/attendance.
--
-- Ищем учителя по имени, а не по захардкоженному id — миграция должна
-- одинаково отработать на всех копиях базы (см. память
-- project_dev_machine_sync про несинхронизированные окружения). Если имя не
-- совпадёт ни с одним учителем организации — миграция ничего не сделает
-- (updated будет 0), а не упадёт и не перепишет случайно чужого владельца.
do $$
declare
  v_teacher_id uuid;
  v_updated int;
begin
  select p.id into v_teacher_id
  from profiles p
  where p.role = 'teacher'
    and p.full_name = 'Иванова Мария Петровна'
  limit 1;

  if v_teacher_id is null then
    raise notice 'Учитель "Иванова Мария Петровна" не найден — перенос журналов пропущен';
    return;
  end if;

  update attendance_journals j
  set created_by = v_teacher_id
  from profiles admin_p
  where j.created_by = admin_p.id
    and admin_p.role = 'admin'
    and j.organization_id = admin_p.organization_id
    and admin_p.organization_id = (select organization_id from profiles where id = v_teacher_id);

  get diagnostics v_updated = row_count;
  raise notice 'Журналов посещаемости перенесено на Иванову М.П.: %', v_updated;
end $$;
