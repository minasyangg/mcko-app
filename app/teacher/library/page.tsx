import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LibraryClient } from '@/components/teacher/LibraryClient'
import { AddTargetBanner } from '@/components/teacher/AddTargetBanner'

export default async function LibraryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Загружаем только канонические темы (ФИПИ КЭС) для фильтрации
  const { data: allTopics } = await supabase
    .from('library_topics')
    .select('id, exam_type, subject, grade, fipicod, name, parent_id, sort_order')
    .eq('is_canonical', true)
    .order('exam_type').order('subject').order('sort_order').order('fipicod')

  // Считаем общее число задач
  const { count: totalProblems } = await supabase
    .from('library_problems')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  return (
    <div className="space-y-4">
      <AddTargetBanner />
      <LibraryClient
        initialTopics={allTopics ?? []}
        totalProblems={totalProblems ?? 0}
      />
    </div>
  )
}
