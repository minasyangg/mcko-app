import { finalizeAttempt, updateCumulativeResult, type AdminClient } from '@/lib/grading/finalize'

// Принудительное завершение назначения (миграция 038).
//
// Закрытие бывает двух охватов и они не заменяют друг друга:
//   • по ученику  — строка student_final_results с closed_reason = 'forced';
//   • по назначению — assignments.closed_at, действует на всех адресатов,
//     включая тех, у кого ещё нет ни одной попытки и ни одной строки итога
//     (частый случай для групповых назначений — иначе «завершить для всех»
//     ничего бы не значило для не приступивших).
//
// Всё, что не сдано, при закрытии доводится до терминального состояния, чтобы
// результат попал в статистику (она читает попытки в submitted/checked, см.
// lib/analytics/queries.ts): in_progress → финализируется с авто-проверкой,
// not_started → expired.

export interface CloseResult {
  /** Ученики, для которых пересчитан и закрыт итог */
  closedStudents: number
  /** Попытки, доведённые до submitted/checked (нужны для уведомлений) */
  finalizedAttemptIds: string[]
  /** Не начатые попытки, помеченные expired */
  expired: number
}

// Адресаты назначения: конкретный ученик или все члены группы.
async function resolveTargetStudents(
  admin: AdminClient,
  assignmentId: string
): Promise<string[]> {
  const { data: assignment } = await admin
    .from('assignments')
    .select('student_id, group_id')
    .eq('id', assignmentId)
    .single()
  if (!assignment) return []

  if (assignment.student_id) return [assignment.student_id]
  if (!assignment.group_id) return []

  const { data: members } = await admin
    .from('group_members')
    .select('user_id')
    .eq('group_id', assignment.group_id)
  return (members ?? []).map(m => m.user_id)
}

// Кого этим назначением вообще законно закрывать: текущие адресаты ПЛЮС те, у
// кого по нему уже есть попытки. Второе — не послабление, а покрытие реального
// случая: ученика вывели из группы уже после того, как он сдал работу, и его
// результат всё равно надо уметь закрыть.
//
// Проверка обязательна: student_id приходит из тела запроса, а
// updateCumulativeResult делает upsert — без неё владелец назначения мог бы
// СОЗДАТЬ строку итога на произвольный profile id, в том числе чужой
// организации. Права на само назначение этого не покрывают.
async function resolveClosableStudents(
  admin: AdminClient,
  assignmentId: string
): Promise<Set<string>> {
  const [targets, { data: attemptRows }] = await Promise.all([
    resolveTargetStudents(admin, assignmentId),
    admin.from('attempts').select('student_id').eq('assignment_id', assignmentId),
  ])
  return new Set([...targets, ...(attemptRows ?? []).map(a => a.student_id)])
}

/**
 * Завершает назначение принудительно.
 * @param studentId — закрыть только для одного ученика; без него закрывается
 *   всё назначение (проставляется assignments.closed_at).
 * @returns null, если studentId не относится к этому назначению.
 */
export async function closeAssignment(
  admin: AdminClient,
  opts: { assignmentId: string; closedBy: string; studentId?: string }
): Promise<CloseResult | null> {
  const { assignmentId, closedBy, studentId } = opts

  // Адресаты назначения. Даже при закрытии всего назначения список нужен: у
  // ученика может не быть ни одной попытки, а строку итога («0 из N, завершено»)
  // статистика всё равно должна увидеть.
  const closable = await resolveClosableStudents(admin, assignmentId)
  if (studentId && !closable.has(studentId)) return null
  const targets = studentId ? [studentId] : [...closable]

  // Незавершённые попытки этого назначения (по нужным ученикам)
  let activeQuery = admin
    .from('attempts')
    .select('id, status, student_id')
    .eq('assignment_id', assignmentId)
    .in('status', ['in_progress', 'not_started'])
  if (studentId) activeQuery = activeQuery.eq('student_id', studentId)
  const { data: active } = await activeQuery

  const inProgress = (active ?? []).filter(a => a.status === 'in_progress')
  const notStarted = (active ?? []).filter(a => a.status === 'not_started')

  // Последовательно: внутри finalizeAttempt возможны AI-запросы на письменные
  // задания — параллельный запуск по всей группе выжигает лимиты провайдера.
  const finalizedAttemptIds: string[] = []
  for (const a of inProgress) {
    const res = await finalizeAttempt(a.id, { admin })
    if (res) finalizedAttemptIds.push(a.id)
  }

  let expired = 0
  if (notStarted.length > 0) {
    const { error } = await admin
      .from('attempts')
      .update({ status: 'expired', last_activity_at: new Date().toISOString() })
      .in('id', notStarted.map(a => a.id))
    if (!error) expired = notStarted.length
  }

  // Итог + пометка «закрыто» по каждому адресату. finalizeAttempt выше уже
  // пересчитал итог, но БЕЗ forceCloseBy — здесь проставляется само закрытие.
  // Ученики, у которых попыток не было, тоже получают строку: назначение для
  // них закрыто с нулём, и это осознанный результат, а не пропуск.
  let closedStudents = 0
  for (const sid of targets) {
    const res = await updateCumulativeResult(admin, assignmentId, sid, { forceCloseBy: closedBy })
    if (res) closedStudents++
  }

  if (!studentId) {
    await admin
      .from('assignments')
      .update({ closed_at: new Date().toISOString(), closed_by: closedBy })
      .eq('id', assignmentId)
  }

  return { closedStudents, finalizedAttemptIds, expired }
}

/**
 * Снимает принудительное завершение. Потраченные попытки не возвращает:
 * пересчёт по-прежнему закроет назначение, если попытки исчерпаны или набран
 * полный балл — снимается только «липкий» forced.
 */
export async function reopenAssignment(
  admin: AdminClient,
  opts: { assignmentId: string; studentId?: string }
): Promise<{ reopenedStudents: number }> {
  const { assignmentId, studentId } = opts

  let clearQuery = admin
    .from('student_final_results')
    .update({ closed_reason: null, closed_at: null, closed_by: null, status: 'in_progress' })
    .eq('assignment_id', assignmentId)
    .eq('closed_reason', 'forced')
  if (studentId) clearQuery = clearQuery.eq('student_id', studentId)
  const { data: cleared } = await clearQuery.select('student_id')

  if (!studentId) {
    await admin
      .from('assignments')
      .update({ closed_at: null, closed_by: null })
      .eq('id', assignmentId)
  }

  // Пересчёт вернёт attempts_exhausted/max_score тем, кто закрыт не решением
  // учителя, — снятый выше forced не должен открывать исчерпанное назначение.
  const students = (cleared ?? []).map(r => r.student_id)
  for (const sid of students) {
    await updateCumulativeResult(admin, assignmentId, sid)
  }

  return { reopenedStudents: students.length }
}
