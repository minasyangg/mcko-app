import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/authorize'
import { NOTIFICATION_EVENTS } from '@/lib/notifications/types'

const schema = z.object({
  event_type: z.string(),
  channel: z.enum(['telegram', 'email']).default('telegram'),
  enabled: z.boolean(),
})

// PATCH — админ включает/выключает событие уведомлений для своей организации.
// Отсутствие строки в notification_settings = «включено», поэтому upsert.
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { admin, orgId } = auth

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const { event_type, channel, enabled } = parsed.data

  if (!NOTIFICATION_EVENTS.some(e => e.type === event_type)) {
    return Response.json({ error: 'Неизвестное событие' }, { status: 400 })
  }

  const { error } = await admin.from('notification_settings').upsert({
    organization_id: orgId,
    event_type,
    channel,
    enabled,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,event_type,channel' })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
