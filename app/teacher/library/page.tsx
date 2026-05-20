import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LibraryClient } from '@/components/teacher/LibraryClient'

export default async function LibraryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Загружаем иерархию тем: сначала разделы (parent_id IS NULL), потом подтемы
  const { data: allTopics } = await supabase
    .from('library_topics')
    .select('id, exam_type, subject, grade, fipicod, name, parent_id, sort_order')
    .order('exam_type').order('subject').order('sort_order').order('name')

  // Считаем общее число задач
  const { count: totalProblems } = await supabase
    .from('library_problems')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  return (
    <LibraryClient
      initialTopics={allTopics ?? []}
      totalProblems={totalProblems ?? 0}
    />
  )
}
