import { createAdminClient } from '@/lib/supabase/admin'
import { sendTelegramMessage, telegramConfigured } from '@/lib/notifications/telegram'
import type { NotificationEventType } from '@/lib/notifications/types'

type AdminClient = ReturnType<typeof createAdminClient>

// ── Ядро: отправить событие списку пользователей ────────────────────────────
// Проверяет настройку события (админ мог выключить), находит привязанные
// telegram_chat_id, шлёт и пишет журнал. Никогда не бросает — уведомления
// не должны ломать основной поток (вызывается из after()).
export async function notifyUsers(opts: {
  admin?: AdminClient
  orgId: string | null
  eventType: NotificationEventType
  userIds: string[]
  message: string
}): Promise<void> {
  try {
    const { orgId, eventType, userIds, message } = opts
    if (userIds.length === 0 || !message) return
    const admin = opts.admin ?? createAdminClient()

    // Настройка события: отсутствие строки = включено
    if (orgId) {
      const { data: setting } = await admin
        .from('notification_settings')
        .select('enabled')
        .eq('organization_id', orgId)
        .eq('event_type', eventType)
        .eq('channel', 'telegram')
        .maybeSingle()
      if (setting && !setting.enabled) return
    }

    if (!telegramConfigured()) return

    const { data: profiles } = await admin
      .from('profiles')
      .select('id, telegram_chat_id, notifications_enabled')
      .in('id', [...new Set(userIds)])
      .neq('notifications_enabled', false) // персональный выключатель пользователя

    const rows: {
      organization_id: string | null
      user_id: string
      channel: string
      event_type: string
      message: string
      status: string
      error: string | null
    }[] = []

    for (const p of profiles ?? []) {
      if (!p.telegram_chat_id) continue // телеграм не привязан — тихо пропускаем
      const err = await sendTelegramMessage(p.telegram_chat_id, message)
      rows.push({
        organization_id: orgId,
        user_id: p.id,
        channel: 'telegram',
        event_type: eventType,
        message,
        status: err ? 'failed' : 'sent',
        error: err,
      })
    }
    if (rows.length > 0) await admin.from('notification_log').insert(rows)
  } catch (e) {
    console.error('[notifications] notifyUsers failed:', e)
  }
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU') : null

// ── Событие: назначен тест/ДЗ → ученикам цели назначения ────────────────────
export async function notifyAssignmentCreated(assignmentId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: a } = await admin
      .from('assignments')
      .select(`
        id, organization_id, group_id, student_id, ends_at, max_attempts, kind,
        test_versions!test_version_id ( tests!test_id ( title, kind ) )
      `)
      .eq('id', assignmentId)
      .single()
    if (!a) return

    const test = (a as unknown as { test_versions?: { tests?: { title?: string; kind?: string } } }).test_versions?.tests
    const isHomework = (a.kind ?? test?.kind) === 'homework'

    let userIds: string[] = []
    if (a.student_id) {
      userIds = [a.student_id]
    } else if (a.group_id) {
      const { data: members } = await admin
        .from('group_members').select('user_id').eq('group_id', a.group_id)
      userIds = (members ?? []).map(m => m.user_id)
    }
    if (userIds.length === 0) return

    const due = fmtDate(a.ends_at)
    const message =
      `📝 Вам назначено ${isHomework ? 'домашнее задание' : 'тестирование'}: «${test?.title ?? 'без названия'}». ` +
      `Попыток: ${a.max_attempts ?? 1}.` +
      (due ? ` Выполнить до ${due}.` : '')

    await notifyUsers({ admin, orgId: a.organization_id, eventType: 'assignment_created', userIds, message })
  } catch (e) {
    console.error('[notifications] assignmentCreated failed:', e)
  }
}

// Строка «тест завершён» для сообщений. Полный балл выносим отдельной фразой:
// это единственная причина закрытия, которая для получателя выглядит как
// достижение, а не как ограничение.
function completionLine(closedReason: string | null | undefined): string | null {
  switch (closedReason) {
    case 'max_score': return '🏆 Набран максимальный балл — тест завершён, новых попыток не будет.'
    case 'attempts_exhausted': return '🔒 Тест завершён: попытки исчерпаны.'
    case 'forced': return '🔒 Тест завершён учителем.'
    default: return null
  }
}

// ── Событие: попытка финализирована ──────────────────────────────────────────
// Ученику — результат его работы (checked). Учителю — ЛЮБАЯ сдача: и та, что
// ждёт ручной проверки (attempt_submitted), и полностью авто-проверенная
// (attempt_auto_checked). Раньше второй случай не уведомлял никого, и сдача
// теста с одними тестовыми заданиями проходила для учителя незаметно.
//
// teacherNotice: false — когда финализацию инициировал сам сотрудник и он уже
// видит результат своего действия (проверил работу, принудительно завершил
// назначение). Слать ему в этот момент «работа сдана» — эхо собственного клика,
// причём на группе оно приходит пачкой из десятков сообщений.
export async function notifyAttemptFinalized(
  attemptId: string,
  opts?: { teacherNotice?: boolean }
): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: at } = await admin
      .from('attempts')
      .select(`
        id, status, score, max_score, student_id, assignment_id,
        assignments!inner (
          organization_id, created_by, kind, max_attempts,
          test_versions!test_version_id ( tests!test_id ( title, kind ) )
        )
      `)
      .eq('id', attemptId)
      .single()
    if (!at) return

    const asgn = at.assignments as unknown as {
      organization_id: string | null
      created_by: string | null
      kind: string | null
      max_attempts: number | null
      test_versions?: { tests?: { title?: string; kind?: string } }
    }
    const title = asgn.test_versions?.tests?.title ?? 'без названия'
    const noun = (asgn.kind ?? asgn.test_versions?.tests?.kind) === 'homework' ? 'домашнему заданию' : 'тесту'

    // Накопительный итог и состояние закрытия — то же, что видит ученик на
    // странице результата (см. инвариант «показываем накопительный балл»).
    // notifyAttemptFinalized всегда вызывается через after() ПОСЛЕ пересчёта
    // итога, поэтому строка уже актуальна.
    const [{ data: student }, { data: fin }] = await Promise.all([
      admin.from('profiles').select('full_name').eq('id', at.student_id).single(),
      admin.from('student_final_results')
        .select('final_score, max_score, attempt_count, closed_reason')
        .eq('student_id', at.student_id)
        .eq('assignment_id', at.assignment_id)
        .maybeSingle(),
    ])

    const attemptScore = `${at.score ?? 0} из ${at.max_score ?? '?'}`
    const maxAttempts = asgn.max_attempts ?? 1
    const attemptNo = fin?.attempt_count ?? 1
    const attemptsLine = maxAttempts > 1 ? `Попытка ${attemptNo} из ${maxAttempts}` : null
    // Накопительный итог показываем только когда он может отличаться от балла
    // попытки — на однопопыточном тесте это дубль строки выше.
    const totalLine = maxAttempts > 1 && fin?.final_score != null
      ? `Накопленный итог: ${fin.final_score} из ${fin.max_score ?? '?'}`
      : null
    const closing = completionLine(fin?.closed_reason)

    const lines = (parts: (string | null)[]) => parts.filter(Boolean).join('\n')

    if (at.status === 'checked') {
      await notifyUsers({
        admin,
        orgId: asgn.organization_id,
        eventType: 'attempt_checked',
        userIds: [at.student_id],
        message: lines([
          `✅ Ваша работа по ${noun} «${title}» проверена: ${attemptScore} баллов.`,
          attemptsLine,
          totalLine,
          closing,
        ]),
      })
    }

    if (!asgn.created_by || opts?.teacherNotice === false) return
    // Статус после финализации всегда checked|submitted; страховка от вызова
    // на прочих статусах (expired и т.п.) — учителю там сообщать нечего.
    if (!['checked', 'submitted'].includes(at.status)) return

    const teacherEvent = at.status === 'checked' ? 'attempt_auto_checked' : 'attempt_submitted'
    const header = at.status === 'checked'
      ? `✅ Работа сдана и проверена автоматически`
      : `📬 Работа ждёт проверки`
    // «предварительно» у submitted: часть заданий ещё не оценена учителем,
    // и балл вырастет после ручной проверки
    const scoreLine = at.status === 'checked'
      ? `Балл: ${attemptScore}`
      : `Предварительный балл: ${attemptScore}`

    await notifyUsers({
      admin,
      orgId: asgn.organization_id,
      eventType: teacherEvent,
      userIds: [asgn.created_by],
      message: lines([
        header,
        `${student?.full_name ?? 'Ученик'} — «${title}»`,
        [attemptsLine, scoreLine].filter(Boolean).join(' · '),
        totalLine,
        closing,
      ]),
    })
  } catch (e) {
    console.error('[notifications] attemptFinalized failed:', e)
  }
}
