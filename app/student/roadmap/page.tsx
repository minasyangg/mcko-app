import { createClient } from '@/lib/supabase/server'
import { Route } from 'lucide-react'
import { RoadmapTimeline, type TimelineTopic } from '@/components/student/RoadmapTimeline'

export default async function StudentRoadmapPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Группы ученика → его road map (RLS также ограничивает roadmaps членством)
  const { data: memberships } = await supabase
    .from('group_members').select('group_id').eq('user_id', user.id)
  const groupIds = (memberships ?? []).map(m => m.group_id)

  const { data: roadmaps } = groupIds.length
    ? await supabase.from('roadmaps')
        .select('id, title, subject, group_id')
        .in('group_id', groupIds)
        .order('subject')
        .order('title')
    : { data: [] as { id: string; title: string; subject: string | null; group_id: string | null }[] }

  const roadmapIds = (roadmaps ?? []).map(r => r.id)

  const [{ data: topics }, { data: itemRows }] = await Promise.all([
    roadmapIds.length
      ? supabase.from('roadmap_topics').select('id, roadmap_id, title, sort_order').in('roadmap_id', roadmapIds).order('sort_order')
      : Promise.resolve({ data: [] as { id: string; roadmap_id: string; title: string; sort_order: number }[] }),
    groupIds.length
      ? supabase.from('assignments')
          .select('id, roadmap_topic_id, kind, max_attempts, ends_at, test_versions!test_version_id(tests!test_id(title, is_active))')
          .in('group_id', groupIds).not('roadmap_topic_id', 'is', null)
      : Promise.resolve({ data: [] as never[] }),
  ])

  // Активные назначения (тест не архивирован)
  const items = (itemRows ?? []).filter(a => {
    const tv = a.test_versions as { tests?: { is_active?: boolean } } | null
    return tv?.tests?.is_active !== false
  })

  // Попытки ученика по этим назначениям + накопительные итоги
  const assignmentIds = items.map(a => a.id)
  const [{ data: attempts }, { data: finals }] = assignmentIds.length
    ? await Promise.all([
        supabase.from('attempts')
          .select('assignment_id, status, score, max_score, created_at')
          .in('assignment_id', assignmentIds).eq('student_id', user.id)
          .order('created_at', { ascending: false }),
        supabase.from('student_final_results')
          .select('assignment_id, final_score, max_score, attempt_count')
          .in('assignment_id', assignmentIds).eq('student_id', user.id),
      ])
    : [
        { data: [] as { assignment_id: string | null; status: string; score: number | null; max_score: number | null }[] },
        { data: [] as { assignment_id: string | null; final_score: number | null; max_score: number | null; attempt_count: number | null }[] },
      ]

  const latestByAssignment = new Map<string, { status: string; score: number | null; max_score: number | null }>()
  const usedByAssignment = new Map<string, number>()
  for (const at of attempts ?? []) {
    if (!at.assignment_id) continue
    if (!latestByAssignment.has(at.assignment_id)) latestByAssignment.set(at.assignment_id, at)
    if (['submitted', 'checked'].includes(at.status)) {
      usedByAssignment.set(at.assignment_id, (usedByAssignment.get(at.assignment_id) ?? 0) + 1)
    }
  }

  const finalByAssignment = new Map<string, { final_score: number | null; max_score: number | null; attempt_count: number | null }>()
  for (const f of finals ?? []) {
    if (f.assignment_id) finalByAssignment.set(f.assignment_id, f)
  }

  // Задания по темам
  const itemsByTopic = new Map<string, TimelineTopic['items']>()
  for (const a of items) {
    const tid = a.roadmap_topic_id as string
    const tv = a.test_versions as { tests?: { title?: string } } | null
    const latest = latestByAssignment.get(a.id)
    const fin = finalByAssignment.get(a.id)
    const arr = itemsByTopic.get(tid) ?? []
    arr.push({
      assignment_id: a.id,
      test_title: tv?.tests?.title ?? 'Тест',
      kind: (a.kind as 'homework' | 'test') ?? 'test',
      status: latest?.status ?? 'not_started',
      // накопительный итог, а не балл последней попытки: при повторной
      // попытке балл за уже решённые задания сохраняется, и список должен
      // показывать то же число, что страница результата
      score: fin?.final_score ?? latest?.score ?? null,
      max_score: fin?.max_score ?? latest?.max_score ?? null,
      attempts_used: Math.max(fin?.attempt_count ?? 0, usedByAssignment.get(a.id) ?? 0),
      max_attempts: a.max_attempts ?? 1,
      ends_at: a.ends_at,
    })
    itemsByTopic.set(tid, arr)
  }

  // Темы по road map
  const topicsByRoadmap = new Map<string, TimelineTopic[]>()
  for (const t of topics ?? []) {
    const its = itemsByTopic.get(t.id) ?? []
    const state: TimelineTopic['state'] = its.length > 0 && its.every(i => i.status === 'checked')
      ? 'done'
      : its.some(i => ['in_progress', 'submitted', 'checked'].includes(i.status))
        ? 'active'
        : 'pending'
    const arr = topicsByRoadmap.get(t.roadmap_id) ?? []
    arr.push({ id: t.id, title: t.title, state, items: its })
    topicsByRoadmap.set(t.roadmap_id, arr)
  }

  // Группировка road map по предметам
  const bySubject = new Map<string, { id: string; title: string }[]>()
  for (const r of roadmaps ?? []) {
    const subj = r.subject?.trim() || 'Без предмета'
    const arr = bySubject.get(subj) ?? []
    arr.push({ id: r.id, title: r.title })
    bySubject.set(subj, arr)
  }

  const hasAny = (roadmaps ?? []).length > 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Программа</h1>
        <p className="text-muted-foreground text-sm mt-1">Ваши учебные маршруты по предметам</p>
      </div>

      {!hasAny ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center text-muted-foreground">
          <Route className="h-10 w-10 opacity-40" />
          <p>Вам пока не назначена ни одна программа.</p>
        </div>
      ) : (
        [...bySubject.entries()].map(([subject, rms]) => (
          <section key={subject} className="space-y-4">
            <h2 className="text-lg font-semibold border-b pb-1">{subject}</h2>
            {rms.map(rm => (
              <div key={rm.id} className="space-y-2">
                {rms.length > 1 && <h3 className="text-sm font-medium text-muted-foreground">{rm.title}</h3>}
                <RoadmapTimeline topics={topicsByRoadmap.get(rm.id) ?? []} />
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  )
}
