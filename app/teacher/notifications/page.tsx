import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NotificationsAdminClient } from '@/components/teacher/NotificationsAdminClient'
import { User, Baby } from 'lucide-react'

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

  // Последние отправки — журнал (RLS: admin читает свою организацию).
  // Берём с запасом (recipient/group_id могут склеить несколько строк в
  // одну запись журнала) и обрезаем до 20 записей уже после группировки.
  const { data: rawLogRows } = await supabase
    .from('notification_log')
    .select('id, event_type, status, message, error, created_at, recipient, group_id, profiles ( full_name )')
    .order('created_at', { ascending: false })
    .limit(40)

  // Одно СОБЫТИЕ уведомления (ученику + его родителю) пишет ДВЕ строки в
  // notification_log с одинаковым group_id — раньше это выглядело как две
  // неотличимые строки с одним и тем же ФИО ученика в колонке "Кому", и по
  // журналу нельзя было понять, ушло ли сообщение родителю (живой случай:
  // родитель подтвердил получение, а в журнале это было не видно). Строки
  // с одним group_id склеиваем в одну запись с иконками обоих реальных
  // получателей; строки без group_id (события без родителя — учителю,
  // либо записи до этой миграции) показываем по одной, как раньше.
  type LogRow = NonNullable<typeof rawLogRows>[number]
  const grouped: { key: string; rows: LogRow[] }[] = []
  const seenGroups = new Set<string>()
  for (const r of rawLogRows ?? []) {
    if (r.group_id) {
      if (seenGroups.has(r.group_id)) continue
      seenGroups.add(r.group_id)
      grouped.push({ key: r.group_id, rows: (rawLogRows ?? []).filter(x => x.group_id === r.group_id) })
    } else {
      grouped.push({ key: r.id, rows: [r] })
    }
  }
  const logRows = grouped.slice(0, 20)

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
                {logRows.map(({ key, rows }) => {
                  const self = rows.find(r => r.recipient === 'self')
                  const parent = rows.find(r => r.recipient === 'parent')
                  const main = self ?? parent ?? rows[0]
                  const p = main.profiles as unknown as { full_name?: string } | null

                  return (
                    <tr key={key}>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(main.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span>{p?.full_name ?? '—'}</span>
                          {/* Ребёнок — ученику реально ушло (self); взрослый —
                              родителю (parent). Обе иконки, если ушло обоим. */}
                          <span className="flex items-center gap-0.5 text-muted-foreground" title={
                            self && parent ? 'Ушло ученику и родителю'
                              : parent ? 'Ушло только родителю'
                              : 'Ушло ученику'
                          }>
                            {self && <Baby className="h-3.5 w-3.5" />}
                            {parent && <User className="h-3.5 w-3.5" />}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-80">
                        <span className="line-clamp-2">{main.message}</span>
                        {rows.filter(r => r.error).map(r => (
                          <span key={r.id} className="text-destructive block">
                            {r.recipient === 'parent' ? 'Родителю: ' : ''}{r.error}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        {rows.map(r => (
                          <span
                            key={r.id}
                            className={`block ${r.status === 'sent' ? 'text-green-600' : 'text-destructive'} text-xs`}
                          >
                            {r.recipient === 'parent' ? 'Родителю: ' : rows.length > 1 ? 'Ученику: ' : ''}
                            {r.status === 'sent' ? 'доставлено' : r.status}
                          </span>
                        ))}
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
