import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DoskaBoardsClient } from '@/components/teacher/DoskaBoardsClient'
import { PenLine } from 'lucide-react'

// Список досок учителя. Раньше доска заводилась кнопкой напротив ученика в
// списке учеников — одна на пару, без предмета и без возможности её увидеть
// потом. Теперь это отдельный раздел: здесь доски заводят, находят и удаляют.

export default async function TeacherDoskaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div>Unauthorized</div>

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  // Раздел про «мои доски с моими учениками» — админу здесь делать нечего:
  // свои доски он и так видит внутри самой доски, на просмотр.
  if (profile?.role !== 'teacher') redirect('/teacher')

  const { data: boards } = await supabase
    .from('doska_boards')
    .select('id, title, subject, created_at, updated_at, group_id, groups(name)')
    .eq('owner_id', user.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })

  const boardIds = (boards ?? []).map((b) => b.id)
  const { data: parts } = boardIds.length
    ? await supabase
        .from('doska_board_participants')
        .select('board_id, user_id, profiles!doska_board_participants_user_id_fkey(full_name)')
        .in('board_id', boardIds)
    : { data: [] }

  const byBoard = new Map<string, string[]>()
  for (const p of (parts ?? []) as unknown as
       { board_id: string; profiles: { full_name: string | null } | null }[]) {
    const list = byBoard.get(p.board_id) ?? []
    list.push(p.profiles?.full_name ?? 'ученик')
    byBoard.set(p.board_id, list)
  }

  const rows = (boards ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    subject: b.subject,
    updatedAt: b.updated_at,
    students: byBoard.get(b.id) ?? [],
    group: (b as unknown as { groups: { name: string } | null }).groups?.name ?? null,
  }))

  // Учеников отдаёт RLS — политика «teacher read own students» пускает только
  // закреплённых за этим учителем. Фильтр по организации оставлен как второй
  // рубеж: он не заменяет правило, а страхует от чужой организации, если
  // закрепление вдруг окажется межорганизационным.
  const { data: students } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'student')
    .eq('is_active', true)
    .eq('organization_id', profile?.organization_id || '')
    .order('full_name')

  // Группы — только свои: политика «groups: teacher manage own» отдаёт те, что
  // учитель сам и завёл. Пустые не показываем: доску на них не завести.
  const { data: groupRows } = await supabase
    .from('groups')
    .select('id, name, group_members(count)')
    .eq('created_by', user.id)
    .order('name')
  const groups = (groupRows ?? [])
    .map((g) => ({
      id: g.id as string,
      name: g.name as string,
      size: (g as unknown as { group_members: { count: number }[] }).group_members?.[0]?.count ?? 0,
    }))
    .filter((g) => g.size > 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Доски</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Общие с учениками полотна для занятий. Живут, пока вы их не удалите.
          </p>
        </div>
      </div>

      {!students?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <PenLine className="h-10 w-10 opacity-40" />
          <p>За вами пока не закреплено ни одного ученика — доску не с кем разделить.</p>
        </div>
      ) : (
        <DoskaBoardsClient boards={rows} students={students ?? []} groups={groups} />
      )}
    </div>
  )
}
