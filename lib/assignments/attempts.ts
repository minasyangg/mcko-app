import { updateCumulativeResult, type AdminClient } from '@/lib/grading/finalize'

export interface AddAttemptsResult {
  maxAttempts: number
  /** Ученики, которым назначение снова открылось (кончились попытки → есть новые) */
  reopenedStudents: number
  /** Назначение завершено учителем для всех — новые попытки сами его не откроют */
  closedForAll: boolean
  /**
   * Дедлайн уже прошёл. Попытки всё равно открыты (срок никогда не запрещал
   * начать — только помечал сдачу submitted_late), а работа в добавленную
   * попытку отмечается is_extra_attempt — «решено в доп. попытку», не опоздание.
   */
  deadlinePassed: boolean
}

// Дополнительные попытки — лимит увеличивается у самого назначения, то есть
// для всех адресатов (решение пользователя 2026-11-20: точечных личных попыток
// не нужно). Итог не трогаем: он по-прежнему MAX(awarded_score) по каждому
// заданию среди всех попыток (lib/grading/finalize.ts), новая попытка может
// его только улучшить, а решённые на полный балл задания в ней заблокированы.
//
// Ученик, у которого попытки кончились, закрыт строкой student_final_results с
// closed_reason = 'attempts_exhausted' — эта причина расчётная, её пересчёт с
// новым лимитом снимает. Полный балл (max_score) и решение учителя (forced)
// пересчёт сохраняет: им новые попытки не нужны / запрещены явно.
export async function addAttempts(
  admin: AdminClient,
  opts: {
    assignmentId: string
    add: number
    /** Потолок лимита попыток на назначение — защита от опечатки «+100» подряд (настройка attempts_total_max) */
    maxTotal: number
  }
): Promise<AddAttemptsResult | { error: string }> {
  const { data: assignment } = await admin
    .from('assignments')
    .select('max_attempts, extra_attempts, closed_at, ends_at')
    .eq('id', opts.assignmentId)
    .single()
  if (!assignment) return { error: 'Назначение не найдено' }

  const current = assignment.max_attempts ?? 1
  const maxAttempts = current + opts.add
  if (maxAttempts > opts.maxTotal) {
    return { error: `Не больше ${opts.maxTotal} попыток на назначение (сейчас ${current})` }
  }

  // ends_at не трогаем: срок — факт исходного задания. Сколько попыток
  // добавлено, помним отдельно, чтобы отличать доп. попытку от опоздания (112).
  const { error: updErr } = await admin
    .from('assignments')
    .update({ max_attempts: maxAttempts, extra_attempts: (assignment.extra_attempts ?? 0) + opts.add })
    .eq('id', opts.assignmentId)
  if (updErr) return { error: updErr.message }

  const { data: exhausted } = await admin
    .from('student_final_results')
    .select('student_id')
    .eq('assignment_id', opts.assignmentId)
    .eq('closed_reason', 'attempts_exhausted')

  let reopenedStudents = 0
  for (const { student_id } of exhausted ?? []) {
    const res = await updateCumulativeResult(admin, opts.assignmentId, student_id)
    if (res && res.closedReason === null) reopenedStudents++
  }

  return {
    maxAttempts,
    reopenedStudents,
    closedForAll: assignment.closed_at != null,
    deadlinePassed: assignment.ends_at != null && new Date(assignment.ends_at).getTime() < Date.now(),
  }
}
