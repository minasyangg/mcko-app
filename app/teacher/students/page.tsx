import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Users } from 'lucide-react'

export default async function StudentsPage() {
  const supabase = await createClient()

  const { data: students } = await supabase
    .from('profiles')
    .select('id, full_name, grade, is_active, created_at')
    .eq('role', 'student')
    .order('full_name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ученики</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {students?.length ?? 0} зарегистрированных учеников
        </p>
      </div>

      {!students?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <Users className="h-10 w-10 opacity-40" />
          <p>Нет зарегистрированных учеников.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">ФИО</th>
                <th className="text-left px-4 py-3 font-medium">Класс</th>
                <th className="text-left px-4 py-3 font-medium">Статус</th>
                <th className="text-left px-4 py-3 font-medium">Дата регистрации</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {students.map((s) => (
                <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{s.full_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.grade ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={s.is_active ? 'default' : 'secondary'}>
                      {s.is_active ? 'Активен' : 'Неактивен'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.created_at
                      ? new Date(s.created_at).toLocaleDateString('ru-RU')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
