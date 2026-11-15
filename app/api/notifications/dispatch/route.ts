import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyAssignmentCreated } from '@/lib/notifications/send'

// Рассылка уведомлений о назначениях, открывшихся по дате (миграция 110).
//
// Вызывает не Vercel Cron, а планировщик базы: pg_cron каждые 30 минут с
// 7:00 до 23:30 по Москве (расписание — миграция 111), и только когда есть
// открывшиеся, но ещё не уведомлённые назначения, шлёт сюда POST через
// pg_net. Немедленные назначения уведомляют сами роуты создания — сюда
// попадают только отложенные.
//
// Доступ — по заголовку x-dispatch-secret: секрет лежит в Supabase Vault,
// сверяет его функция notification_dispatch_secret_ok (выполнять может только
// service_role). Переменная окружения в Vercel не нужна.
//
// Повторный или одновременный вызов безопасен: назначение сначала
// «захватывается» (notified_at проставляется условным update), и только
// захвативший вызов отправляет уведомление.

export const maxDuration = 60

const BATCH = 25

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-dispatch-secret') ?? ''
  if (!secret) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: secretOk } = await admin.rpc('notification_dispatch_secret_ok', { p_secret: secret })
  if (secretOk !== true) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date().toISOString()
  const { data: due, error } = await admin
    .from('assignments')
    .select('id')
    .is('notified_at', null)
    .is('closed_at', null)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .order('starts_at', { ascending: true, nullsFirst: true })
    .limit(BATCH)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  let sent = 0
  for (const a of due ?? []) {
    const { data: claimed } = await admin
      .from('assignments')
      .update({ notified_at: now })
      .eq('id', a.id)
      .is('notified_at', null)
      .select('id')
    if (!claimed?.length) continue
    // ошибки отправки notifyAssignmentCreated пишет в лог сам и не бросает
    await notifyAssignmentCreated(a.id)
    sent++
  }

  return Response.json({ due: due?.length ?? 0, sent })
}
