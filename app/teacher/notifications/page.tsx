import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NotificationsAdminClient } from '@/components/teacher/NotificationsAdminClient'

// Админ-панель уведомлений: статус telegram-бота, тумблеры событий,
// последние отправки (журнал).
export default async function NotificationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/teacher')

  // Настройки событий (отсутствие строки = включено)
  const { data: settingRows } = await supabase
    .from('notification_settings')
    .select('event_type, channel, enabled')
    .eq('channel', 'telegram')
  const settings: Record<string, boolean> = {}
  for (const r of settingRows ?? []) settings[r.event_type] = r.enabled

  // Последние отправки — журнал (RLS: admin читает свою организацию)
  const { data: logRows } = await supabase
    .from('notification_log')
    .select('id, event_type, status, message, error, created_at, profiles ( full_name )')
    .order('created_at', { ascending: false })
    .limit(20)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Уведомления</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Telegram-бот и события, о которых платформа уведомляет учеников и учителей
        </p>
      </div>

      <NotificationsAdminClient initialSettings={settings} />

      {(logRows ?? []).length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Последние отправки</h2>
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Когда</th>
                  <th className="text-left px-3 py-2 font-medium">Кому</th>
                  <th className="text-left px-3 py-2 font-medium">Сообщение</th>
                  <th className="text-left px-3 py-2 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(logRows ?? []).map(r => {
                  const p = r.profiles as unknown as { full_name?: string } | null
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 text-xs">{p?.full_name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-80">
                        <span className="line-clamp-2">{r.message}</span>
                        {r.error && <span className="text-destructive block">{r.error}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={r.status === 'sent' ? 'text-green-600 text-xs' : 'text-destructive text-xs'}>
                          {r.status === 'sent' ? 'доставлено' : r.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
