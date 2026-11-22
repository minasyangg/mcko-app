import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { normalizeSettings } from '@/lib/settings/registry'
import { SystemSettingsClient } from '@/components/teacher/SystemSettingsClient'

export const metadata = { title: 'Настройки системы' }

// Пороги и расписания, которые раньше правились в БД вручную (миграция 114).
export default async function SystemSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/teacher')

  // Таблица закрыта RLS для всех, кроме service role
  const { data: rows } = await createAdminClient()
    .from('app_settings')
    .select('key, value, updated_at')
    .limit(100)

  const changedAt: Record<string, string> = {}
  for (const r of rows ?? []) changedAt[r.key] = r.updated_at

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Настройки системы</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Сроки и пороги, общие для всей школы. Изменения действуют сразу после сохранения.
        </p>
      </div>
      <SystemSettingsClient initial={normalizeSettings(rows)} changedAt={changedAt} />
    </div>
  )
}
