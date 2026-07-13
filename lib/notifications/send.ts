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

// ── Событие: попытка финализирована ──────────────────────────────────────────
// checked  → ученику результат; submitted → учителю «ждёт проверки».
export async function notifyAttemptFinalized(attemptId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: at } = await admin
      .from('attempts')
      .select(`
        id, status, score, max_score, student_id,
        assignments!inner (
          organization_id, created_by, kind,
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
      test_versions?: { tests?: { title?: string; kind?: string } }
    }
    const title = asgn.test_versions?.tests?.title ?? 'без названия'
    const noun = (asgn.kind ?? asgn.test_versions?.tests?.kind) === 'homework' ? 'домашнему заданию' : 'тесту'

    if (at.status === 'checked') {
      await notifyUsers({
        admin,
        orgId: asgn.organization_id,
        eventType: 'attempt_checked',
        userIds: [at.student_id],
        message: `✅ Ваша работа по ${noun} «${title}» проверена: ${at.score ?? 0} из ${at.max_score ?? '?'} баллов.`,
      })
    } else if (at.status === 'submitted' && asgn.created_by) {
      const { data: student } = await admin
        .from('profiles').select('full_name').eq('id', at.student_id).single()
      await notifyUsers({
        admin,
        orgId: asgn.organization_id,
        eventType: 'attempt_submitted',
        userIds: [asgn.created_by],
        message: `📬 Работа ждёт проверки: ${student?.full_name ?? 'ученик'} — «${title}».`,
      })
    }
  } catch (e) {
    console.error('[notifications] attemptFinalized failed:', e)
  }
}
