import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { History } from 'lucide-react'

const roleLabel: Record<string, string> = {
  admin: 'Админ', teacher: 'Учитель', student: 'Ученик',
}

// Компактная подпись браузера/устройства из user-agent
function uaLabel(ua: string | null): string {
  if (!ua) return '—'
  const os =
    /Windows/i.test(ua) ? 'Windows' :
    /Android/i.test(ua) ? 'Android' :
    /iPhone|iPad/i.test(ua) ? 'iOS' :
    /Mac OS/i.test(ua) ? 'macOS' :
    /Linux/i.test(ua) ? 'Linux' : '?'
  const browser =
    /Edg\//i.test(ua) ? 'Edge' :
    /OPR\/|Opera/i.test(ua) ? 'Opera' :
    /YaBrowser/i.test(ua) ? 'Яндекс' :
    /Firefox\//i.test(ua) ? 'Firefox' :
    /Chrome\//i.test(ua) ? 'Chrome' :
    /Safari\//i.test(ua) ? 'Safari' : '?'
  return `${browser} · ${os}`
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// Журнал входов (login_events наполняется триггером на auth.sessions,
// хранится 30 дней). Только admin — RLS отдаёт события своей организации.
export default async function SessionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/teacher')

  const { data: events } = await supabase
    .from('login_events')
    .select('id, user_id, ip, user_agent, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  // Имена/роли одним запросом
  const userIds = [...new Set((events ?? []).map(e => e.user_id))]
  const { data: profiles } = userIds.length
    ? await supabase.from('profiles').select('id, full_name, role').in('id', userIds)
    : { data: [] as { id: string; full_name: string; role: string }[] }
  const byId = new Map((profiles ?? []).map(p => [p.id, p]))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Сессии</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Журнал входов пользователей организации за последние 30 дней
        </p>
      </div>

      {!events?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <History className="h-10 w-10 opacity-40" />
          <p>Пока нет записей о входах.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Пользователь</th>
                  <th className="text-left px-4 py-3 font-medium">Роль</th>
                  <th className="text-left px-4 py-3 font-medium">Вход</th>
                  <th className="text-left px-4 py-3 font-medium">IP</th>
                  <th className="text-left px-4 py-3 font-medium">Устройство</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {events.map(e => {
                  const p = byId.get(e.user_id)
                  return (
                    <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-medium">{p?.full_name ?? 'Удалённый пользователь'}</td>
                      <td className="px-4 py-2.5">
                        {p ? (
                          <Badge variant={p.role === 'admin' ? 'default' : 'secondary'} className="text-[11px]">
                            {roleLabel[p.role] ?? p.role}
                          </Badge>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap tabular-nums">{fmt(e.created_at)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{e.ip ?? '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs" title={e.user_agent ?? ''}>
                        {uaLabel(e.user_agent)}
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
