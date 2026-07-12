import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Route, Users, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// Read-only «кабинет» учителя для админа: его программы (road map) по
// предметам, темы с привязанными ДЗ/тестами и прогресс учеников.
export default async function TeacherCabinetPage({ params }: { params: Promise<{ teacherId: string }> }) {
  const { teacherId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase.from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!me || me.role !== 'admin' || !me.organization_id) redirect('/teacher')

  const admin = createAdminClient()
  const { data: teacher } = await admin
    .from('profiles').select('id, full_name, role, organization_id').eq('id', teacherId).single()
  if (!teacher || teacher.role !== 'teacher' || teacher.organization_id !== me.organization_id) notFound()

  const { data: roadmaps } = await admin
    .from('roadmaps').select('id, title, subject, group_id').eq('created_by', teacherId).order('subject').order('title')

  const roadmapIds = (roadmaps ?? []).map(r => r.id)
  const groupIds = (roadmaps ?? []).map(r => r.group_id).filter(Boolean) as string[]

  const [{ data: topics }, { data: itemRows }, { data: members }] = await Promise.all([
    roadmapIds.length
      ? admin.from('roadmap_topics').select('id, roadmap_id, title, sort_order').in('roadmap_id', roadmapIds).order('sort_order')
      : Promise.resolve({ data: [] as { id: string; roadmap_id: string; title: string; sort_order: number }[] }),
    groupIds.length
      ? admin.from('assignments').select('id, group_id, roadmap_topic_id, kind, test_versions!test_version_id(tests!test_id(title))').in('group_id', groupIds).not('roadmap_topic_id', 'is', null)
      : Promise.resolve({ data: [] as { id: string; group_id: string | null; roadmap_topic_id: string | null; kind: string | null; test_versions: unknown }[] }),
    groupIds.length
      ? admin.from('group_members').select('group_id, user_id').in('group_id', groupIds)
      : Promise.resolve({ data: [] as { group_id: string; user_id: string }[] }),
  ])

  // Профили учеников
  const studentIds = [...new Set((members ?? []).map(m => m.user_id))]
  const { data: studentProfiles } = studentIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', studentIds)
    : { data: [] as { id: string; full_name: string }[] }
  const nameById = new Map((studentProfiles ?? []).map(s => [s.id, s.full_name]))

  // Попытки (для расчёта «выполнено»)
  const assignmentIds = (itemRows ?? []).map(a => a.id)
  const { data: attempts } = assignmentIds.length
    ? await admin.from('attempts').select('assignment_id, student_id, status').in('assignment_id', assignmentIds).eq('status', 'checked')
    : { data: [] as { assignment_id: string; student_id: string; status: string }[] }
  const checkedSet = new Set((attempts ?? []).map(a => `${a.assignment_id}_${a.student_id}`))

  // group_id → students (member ids)
  const studentsByGroup = new Map<string, string[]>()
  for (const m of members ?? []) {
    const arr = studentsByGroup.get(m.group_id) ?? []
    arr.push(m.user_id); studentsByGroup.set(m.group_id, arr)
  }
  // topic_id → item assignments
  const itemsByTopic = new Map<string, { id: string; kind: string; title: string }[]>()
  for (const a of itemRows ?? []) {
    const tid = a.roadmap_topic_id as string
    const tv = a.test_versions as { tests?: { title?: string } } | null
    const arr = itemsByTopic.get(tid) ?? []
    arr.push({ id: a.id, kind: (a.kind as string) ?? 'test', title: tv?.tests?.title ?? 'Тест' })
    itemsByTopic.set(tid, arr)
  }
  const topicsByRoadmap = new Map<string, typeof topics>()
  for (const t of topics ?? []) {
    const arr = topicsByRoadmap.get(t.roadmap_id) ?? []
    arr.push(t); topicsByRoadmap.set(t.roadmap_id, arr)
  }

  const bySubject = new Map<string, typeof roadmaps>()
  for (const r of roadmaps ?? []) {
    const subj = r.subject?.trim() || 'Без предмета'
    const arr = bySubject.get(subj) ?? []
    arr.push(r); bySubject.set(subj, arr)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <Button asChild variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-muted-foreground">
          <Link href="/teacher/users"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> К пользователям</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Кабинет: {teacher.full_name}</h1>
        <p className="text-sm text-muted-foreground">Программы учителя, темы и прогресс учеников (только просмотр)</p>
      </div>

      {(roadmaps ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center text-muted-foreground">
          <Route className="h-10 w-10 opacity-40" />
          <p>У этого учителя пока нет программ.</p>
        </div>
      ) : (
        [...bySubject.entries()].map(([subject, rms]) => (
          <section key={subject} className="space-y-3">
            <h2 className="text-lg font-semibold border-b pb-1">{subject}</h2>
            {(rms ?? []).map(rm => {
              const rmMembers = rm.group_id ? (studentsByGroup.get(rm.group_id) ?? []) : []
              const rmTopics = topicsByRoadmap.get(rm.id) ?? []
              return (
                <div key={rm.id} className="rounded-md border">
                  <div className="px-4 py-2.5 border-b bg-muted/30">
                    <div className="font-medium">{rm.title}</div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      {rmMembers.length === 0 ? 'нет учеников'
                        : rmMembers.map(id => <Badge key={id} variant="outline" className="text-[11px] font-normal">{nameById.get(id) ?? '—'}</Badge>)}
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    {rmTopics.length === 0 && <p className="text-xs text-muted-foreground">Тем нет</p>}
                    {rmTopics.map((t, i) => {
                      const items = itemsByTopic.get(t.id) ?? []
                      const doneCount = rmMembers.filter(sid => items.length > 0 && items.every(it => checkedSet.has(`${it.id}_${sid}`))).length
                      return (
                        <div key={t.id} className="rounded-md border px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{i + 1}. {t.title}</span>
                            {items.length > 0 && rmMembers.length > 0 && (
                              <span className={cn('inline-flex items-center gap-1 text-xs',
                                doneCount === rmMembers.length ? 'text-emerald-600' : 'text-muted-foreground')}>
                                <Check className="h-3.5 w-3.5" /> выполнили {doneCount}/{rmMembers.length}
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {items.length === 0 ? <span className="text-xs text-muted-foreground">заданий нет</span>
                              : items.map(it => (
                                <span key={it.id} className="inline-flex items-center gap-1 text-xs">
                                  <Badge variant={it.kind === 'homework' ? 'outline' : 'secondary'} className="text-[11px]">
                                    {it.kind === 'homework' ? 'ДЗ' : 'Тест'}
                                  </Badge>
                                  <span className="text-muted-foreground">{it.title}</span>
                                </span>
                              ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </section>
        ))
      )}
    </div>
  )
}
