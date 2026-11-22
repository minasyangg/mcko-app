import { finalizeAttempt, updateCumulativeResult, type AdminClient } from '@/lib/grading/finalize'
import { openedAt } from '@/lib/assignments/opening'
import { DAY_MS } from '@/lib/settings/registry'

// Архив заданий в кабинете ученика (миграция 113).
//
// Старые назначения (ОГЭ прошлого года у тех, кто уже готовится к ЕГЭ)
// заслоняли актуальную программу в «Мои задания». Убрать в архив можно только
// назначение, открытое больше archive_after_days дней назад (настройка
// системы, 114; по умолчанию полгода), — свежие задания так не спрятать.
//
// Архив закрывает назначение для ученика и пишет итог, как завершение учителем
// (lib/assignments/close.ts): начатая попытка с ответами сдаётся и проверяется,
// пустая и не начатая помечаются expired. Не дал ни одного ответа — итог
// «0 баллов, 0 попыток», а не отсутствие строки: в статистике это осознанное
// «не сделано», а не пропуск.

/** Назначение провисело archiveAfterDays дней с открытия — его можно убрать в архив */
export function canArchive(
  a: { starts_at?: string | null; created_at?: string | null },
  archiveAfterDays: number,
  now: Date = new Date()
): boolean {
  const opened = openedAt(a)
  if (!opened) return false
  return now.getTime() - new Date(opened).getTime() >= archiveAfterDays * DAY_MS
}

// Пустая строка, пустой массив/объект — ответа нет (поле очищали)
function hasAnswer(v: unknown): boolean {
  if (v == null || v === '') return false
  if (Array.isArray(v)) return v.some(hasAnswer)
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some(hasAnswer)
  return true
}

export interface ArchiveResult {
  /** Начатая попытка с ответами сдана и проверена */
  finalizedAttemptId: string | null
  finalScore: number
  maxScore: number
}

export async function archiveForStudent(
  admin: AdminClient,
  opts: { assignmentId: string; studentId: string }
): Promise<ArchiveResult | null> {
  const { assignmentId, studentId } = opts

  const { data: active } = await admin
    .from('attempts')
    .select('id, status')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .in('status', ['in_progress', 'not_started'])

  let finalizedAttemptId: string | null = null
  const toExpire: string[] = []
  for (const a of active ?? []) {
    if (a.status === 'in_progress') {
      const { data: answers } = await admin
        .from('attempt_task_answers')
        .select('answer_json')
        .eq('attempt_id', a.id)
        .limit(200)
      if ((answers ?? []).some(r => hasAnswer(r.answer_json))) {
        if (await finalizeAttempt(a.id, { admin })) finalizedAttemptId = a.id
        continue
      }
    }
    toExpire.push(a.id)
  }
  if (toExpire.length > 0) {
    await admin
      .from('attempts')
      .update({ status: 'expired', last_activity_at: new Date().toISOString() })
      .in('id', toExpire)
  }

  const res = await updateCumulativeResult(admin, assignmentId, studentId, { archive: true })
  if (!res) return null
  return { finalizedAttemptId, finalScore: res.finalScore, maxScore: res.maxScore }
}

/** Вернуть из архива: метка снимается, закрытие пересчитывается по попыткам */
export async function unarchiveForStudent(
  admin: AdminClient,
  opts: { assignmentId: string; studentId: string }
): Promise<boolean> {
  const res = await updateCumulativeResult(admin, opts.assignmentId, opts.studentId, { archive: false })
  return res != null
}
