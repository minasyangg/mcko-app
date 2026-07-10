import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RoadmapClient, type RoadmapRow } from '@/components/teacher/RoadmapClient'

// Программы (road map) — только учитель. Админ смотрит кабинеты учителей через
// раздел «Пользователи».
export default async function RoadmapsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'admin') redirect('/teacher/users')

  const { data: roadmaps } = await supabase
    .from('roadmaps')
    .select('id, title, subject, description, group_id, created_at')
    .order('created_at', { ascending: false })

  // Счётчики тем и учеников
  const ids = (roadmaps ?? []).map(r => r.id)
  const groupIds = (roadmaps ?? []).map(r => r.group_id).filter(Boolean) as string[]

  const [{ data: topics }, { data: members }] = await Promise.all([
    ids.length ? supabase.from('roadmap_topics').select('roadmap_id').in('roadmap_id', ids) : Promise.resolve({ data: [] }),
    groupIds.length ? supabase.from('group_members').select('group_id').in('group_id', groupIds) : Promise.resolve({ data: [] }),
  ])
  const topicCount = new Map<string, number>()
  for (const t of topics ?? []) topicCount.set(t.roadmap_id, (topicCount.get(t.roadmap_id) ?? 0) + 1)
  const memberCount = new Map<string, number>()
  for (const m of members ?? []) memberCount.set(m.group_id, (memberCount.get(m.group_id) ?? 0) + 1)

  const rows: RoadmapRow[] = (roadmaps ?? []).map(r => ({
    id: r.id,
    title: r.title,
    subject: r.subject,
    description: r.description,
    topic_count: topicCount.get(r.id) ?? 0,
    student_count: r.group_id ? (memberCount.get(r.group_id) ?? 0) : 0,
  }))

  return <RoadmapClient roadmaps={rows} />
}
