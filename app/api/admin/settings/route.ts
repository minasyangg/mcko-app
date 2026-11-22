import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-user'
import {
  DEFAULT_SETTINGS, dispatchCron, isSettingKey, normalizeSettings,
  validateSetting, validateSettingsCombo, type SettingKey,
} from '@/lib/settings/registry'

// Значение — целое число; null — сбросить к значению по умолчанию
const putSchema = z.object({
  values: z.record(z.string(), z.number().nullable()),
})

const NOTIFY_KEYS: SettingKey[] = ['notify_from_hour', 'notify_to_hour', 'notify_interval_min']

// PUT /api/admin/settings — сохранить настройки системы (114). Только admin.
// Меняются лишь переданные ключи. Расписание рассылки переставляется в pg_cron
// ДО записи значений: не удалось — не сохраняем ничего, иначе страница
// показывала бы расписание, которого на деле нет.
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Только для администратора' }, { status: 403 })

  const parsed = putSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })

  const changes = new Map<SettingKey, number | null>()
  for (const [key, value] of Object.entries(parsed.data.values)) {
    if (!isSettingKey(key)) return NextResponse.json({ error: `Неизвестная настройка: ${key}` }, { status: 400 })
    if (value !== null) {
      const err = validateSetting(key, value)
      if (err) return NextResponse.json({ error: err }, { status: 400 })
    }
    changes.set(key, value)
  }
  if (changes.size === 0) return NextResponse.json({ ok: true })

  const admin = createAdminClient()
  const { data: rows, error: readErr } = await admin.from('app_settings').select('key, value').limit(100)
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })

  const current = normalizeSettings(rows)
  const next = { ...current }
  for (const [key, value] of changes) next[key] = value ?? DEFAULT_SETTINGS[key]
  const comboErr = validateSettingsCombo(next)
  if (comboErr) return NextResponse.json({ error: comboErr }, { status: 400 })

  const oldCron = dispatchCron(current)
  const newCron = dispatchCron(next)
  const scheduleChanged = NOTIFY_KEYS.some(k => changes.has(k)) && newCron !== oldCron
  if (scheduleChanged) {
    const { error } = await admin.rpc('set_notification_dispatch_schedule', { p_schedule: newCron })
    if (error) return NextResponse.json({ error: `Расписание рассылки не изменено: ${error.message}` }, { status: 500 })
  }

  const now = new Date().toISOString()
  const upserts = [...changes].filter(([, v]) => v !== null)
    .map(([key, value]) => ({ key, value: value as number, updated_at: now, updated_by: user.id }))
  const resets = [...changes].filter(([, v]) => v === null).map(([key]) => key)

  const [{ error: upErr }, { error: delErr }] = await Promise.all([
    upserts.length > 0
      ? admin.from('app_settings').upsert(upserts, { onConflict: 'key' })
      : Promise.resolve({ error: null }),
    resets.length > 0
      ? admin.from('app_settings').delete().in('key', resets)
      : Promise.resolve({ error: null }),
  ])
  if (upErr || delErr) {
    // значения не записались — возвращаем расписание, чтобы оно совпадало с ними
    if (scheduleChanged) await admin.rpc('set_notification_dispatch_schedule', { p_schedule: oldCron })
    return NextResponse.json({ error: (upErr ?? delErr)!.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, settings: next, schedule: scheduleChanged ? newCron : undefined })
}
