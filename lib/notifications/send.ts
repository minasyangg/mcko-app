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

const lines = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join('\n')

// ── Контекст назначения для текста сообщений ────────────────────────────────
// Одно название теста получателю мало: и ДЗ из программы, и точно такой же тест,
// назначенный группе, приходят с одинаковым заголовком. Учителю нужен источник
// (программа / группа / персонально) — по нему он понимает, где искать работу;
// ученику источник не нужен (он видит задание в своём списке), но нужен предмет.
interface AssignmentContext {
  organizationId: string | null
  createdBy: string | null
  groupId: string | null
  studentId: string | null
  endsAt: string | null
  maxAttempts: number
  title: string
  /** «Домашнее задание» | «Тест» */
  kindLabel: string
  /** «домашнему заданию» | «тесту» — для фраз вида «работа по …» */
  kindDative: string
  /** «Задание завершено» | «Тест завершён» — род зависит от вида работы */
  doneUpper: string
  doneLower: string
  subject: string | null
  /** «Программа «X»» | «Группа «Y»» | «Персональное назначение» */
  source: string | null
}

async function loadAssignmentContext(
  admin: AdminClient,
  assignmentId: string
): Promise<AssignmentContext | null> {
  const { data } = await admin
    .from('assignments')
    .select(`
      id, organization_id, created_by, group_id, student_id, ends_at, max_attempts, kind,
      roadmap_topic_id,
      groups ( name ),
      test_versions!test_version_id ( tests!test_id ( title, kind, subject ) )
    `)
    .eq('id', assignmentId)
    .single()
  if (!data) return null

  const a = data as unknown as {
    organization_id: string | null
    created_by: string | null
    group_id: string | null
    student_id: string | null
    ends_at: string | null
    max_attempts: number | null
    kind: string | null
    roadmap_topic_id: string | null
    groups?: { name?: string } | null
    test_versions?: { tests?: { title?: string; kind?: string; subject?: string | null } } | null
  }

  const test = a.test_versions?.tests
  // метка назначения важнее вида теста: программа может выдать тест как ДЗ
  const isHomework = (a.kind ?? test?.kind) === 'homework'

  // Название программы — отдельным запросом, а не вложенным embed'ом
  // roadmap_topics→roadmaps: лишний round-trip случается только у заданий
  // программы, зато сбой встроенного join'а не обнуляет весь контекст (при
  // null-контексте уведомление не уходит вовсе, а падение здесь тихое —
  // notifyUsers вызывается из after()).
  let roadmapTitle: string | null = null
  if (a.roadmap_topic_id) {
    const { data: topic } = await admin
      .from('roadmap_topics')
      .select('roadmaps!roadmap_id ( title )')
      .eq('id', a.roadmap_topic_id)
      .maybeSingle()
    roadmapTitle = (topic as unknown as { roadmaps?: { title?: string } | null } | null)
      ?.roadmaps?.title ?? null
  }

  // roadmap_topic_id проверяется ПЕРВЫМ: у задания программы group_id тоже
  // заполнен (системная группа программы), и по нему источник определился бы
  // как обычная группа.
  const source = a.roadmap_topic_id
    ? `Программа «${roadmapTitle ?? 'без названия'}»`
    : a.group_id
      ? `Группа «${a.groups?.name ?? 'без названия'}»`
      : a.student_id
        ? 'Персональное назначение'
        : null

  return {
    organizationId: a.organization_id,
    createdBy: a.created_by,
    groupId: a.group_id,
    studentId: a.student_id,
    endsAt: a.ends_at,
    maxAttempts: a.max_attempts ?? 1,
    title: test?.title ?? 'без названия',
    kindLabel: isHomework ? 'Домашнее задание' : 'Тест',
    kindDative: isHomework ? 'домашнему заданию' : 'тесту',
    doneUpper: isHomework ? 'Задание завершено' : 'Тест завершён',
    doneLower: isHomework ? 'задание завершено' : 'тест завершён',
    subject: test?.subject?.trim() || null,
    source,
  }
}

// ── Событие: назначен тест/ДЗ → ученикам цели назначения ────────────────────
export async function notifyAssignmentCreated(assignmentId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const ctx = await loadAssignmentContext(admin, assignmentId)
    if (!ctx) return

    let userIds: string[] = []
    if (ctx.studentId) {
      userIds = [ctx.studentId]
    } else if (ctx.groupId) {
      const { data: members } = await admin
        .from('group_members').select('user_id').eq('group_id', ctx.groupId)
      userIds = (members ?? []).map(m => m.user_id)
    }
    if (userIds.length === 0) return

    const due = fmtDate(ctx.endsAt)
    // Ученику — предмет и вид работы; откуда пришло назначение (программа или
    // группа), ему не важно: задание всё равно одно и лежит в его списке.
    const message = lines([
      `📝 Вам назначен${ctx.kindLabel === 'Тест' ? '' : 'о'} ${ctx.kindLabel.toLowerCase()}: «${ctx.title}»`,
      ctx.subject ? `Предмет: ${ctx.subject}` : null,
      `Попыток: ${ctx.maxAttempts}${due ? ` · выполнить до ${due}` : ''}`,
    ])

    await notifyUsers({ admin, orgId: ctx.organizationId, eventType: 'assignment_created', userIds, message })
  } catch (e) {
    console.error('[notifications] assignmentCreated failed:', e)
  }
}

// Строка «работа завершена» для сообщений. Полный балл выносим отдельной
// фразой: это единственная причина закрытия, которая для получателя выглядит
// как достижение, а не как ограничение.
function completionLine(closedReason: string | null | undefined, ctx: AssignmentContext): string | null {
  switch (closedReason) {
    case 'max_score': return `🏆 Набран максимальный балл — ${ctx.doneLower}, новых попыток не будет.`
    case 'attempts_exhausted': return `🔒 ${ctx.doneUpper}: попытки исчерпаны.`
    case 'forced': return `🔒 ${ctx.doneUpper} учителем.`
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
      .select('id, status, score, max_score, student_id, assignment_id')
      .eq('id', attemptId)
      .single()
    if (!at) return

    const ctx = await loadAssignmentContext(admin, at.assignment_id)
    if (!ctx) return

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
    const maxAttempts = ctx.maxAttempts
    const attemptNo = fin?.attempt_count ?? 1
    const attemptsLine = maxAttempts > 1 ? `Попытка ${attemptNo} из ${maxAttempts}` : null
    // Накопительный итог показываем только когда он может отличаться от балла
    // попытки — на однопопыточном тесте это дубль строки выше.
    const totalLine = maxAttempts > 1 && fin?.final_score != null
      ? `Накопленный итог: ${fin.final_score} из ${fin.max_score ?? '?'}`
      : null
    const closing = completionLine(fin?.closed_reason, ctx)

    if (at.status === 'checked') {
      await notifyUsers({
        admin,
        orgId: ctx.organizationId,
        eventType: 'attempt_checked',
        userIds: [at.student_id],
        message: lines([
          `✅ Ваша работа по ${ctx.kindDative} «${ctx.title}» проверена: ${attemptScore} баллов.`,
          ctx.subject ? `Предмет: ${ctx.subject}` : null,
          attemptsLine,
          totalLine,
          closing,
        ]),
      })
    }

    if (!ctx.createdBy || opts?.teacherNotice === false) return
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
      orgId: ctx.organizationId,
      eventType: teacherEvent,
      userIds: [ctx.createdBy],
      message: lines([
        header,
        `${student?.full_name ?? 'Ученик'} — «${ctx.title}»`,
        // вид работы · предмет · откуда назначено — по одному названию теста
        // учитель не отличит ДЗ из программы от такого же теста у группы
        [ctx.kindLabel, ctx.subject, ctx.source].filter(Boolean).join(' · '),
        [attemptsLine, scoreLine].filter(Boolean).join(' · '),
        totalLine,
        closing,
      ]),
    })
  } catch (e) {
    console.error('[notifications] attemptFinalized failed:', e)
  }
}
