import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { RoadmapEditor, type EditorTopic } from '@/components/teacher/RoadmapEditor'

export default async function RoadmapEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'admin') redirect('/teacher/users')

  // RLS отдаёт только свою программу
  const { data: roadmap } = await supabase
    .from('roadmaps').select('id, title, subject, description, group_id').eq('id', id).single()
  if (!roadmap) notFound()

  const [{ data: topics }, { data: itemRows }, { data: tests }, { data: links }, { data: members }] = await Promise.all([
    supabase.from('roadmap_topics').select('id, title, description, sort_order').eq('roadmap_id', id).order('sort_order'),
    supabase.from('assignments')
      .select('id, roadmap_topic_id, kind, max_attempts, ends_at, test_versions!test_version_id(tests!test_id(title))')
      .eq('group_id', roadmap.group_id || '').not('roadmap_topic_id', 'is', null),
    supabase.from('tests').select('id, title')
      .eq('created_by', user.id).eq('status', 'published').eq('is_active', true)
      .not('current_published_version_id', 'is', null).order('title'),
    supabase.from('teacher_students').select('student_id').eq('teacher_id', user.id),
    roadmap.group_id
      ? supabase.from('group_members').select('user_id').eq('group_id', roadmap.group_id)
      : Promise.resolve({ data: [] as { user_id: string }[] }),
  ])

  // Профили закреплённых учеников
  const studentIds = (links ?? []).map(l => l.student_id)
  const { data: students } = studentIds.length
    ? await supabase.from('profiles').select('id, full_name, grade').in('id', studentIds).order('full_name')
    : { data: [] as { id: string; full_name: string; grade: string | null }[] }

  // Задания по темам
  const itemsByTopic = new Map<string, EditorTopic['items']>()
  for (const a of itemRows ?? []) {
    const tid = a.roadmap_topic_id as string
    const title = (a.test_versions as { tests?: { title?: string } } | null)?.tests?.title ?? 'Тест'
    const arr = itemsByTopic.get(tid) ?? []
    arr.push({ assignment_id: a.id, test_title: title, kind: (a.kind as 'homework' | 'test') ?? 'test', max_attempts: a.max_attempts ?? 1, ends_at: a.ends_at })
    itemsByTopic.set(tid, arr)
  }

  const editorTopics: EditorTopic[] = (topics ?? []).map(t => ({
    id: t.id, title: t.title, description: t.description, sort_order: t.sort_order,
    items: itemsByTopic.get(t.id) ?? [],
  }))

  return (
    <RoadmapEditor
      roadmap={{ id: roadmap.id, title: roadmap.title, subject: roadmap.subject, description: roadmap.description }}
      topics={editorTopics}
      tests={tests ?? []}
      students={students ?? []}
      memberIds={(members ?? []).map(m => m.user_id)}
    />
  )
}
