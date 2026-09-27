import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import { redirect } from 'next/navigation'
import { LibraryClient } from '@/components/teacher/LibraryClient'
import { AddTargetBanner } from '@/components/teacher/AddTargetBanner'
import { getAuthUser } from '@/lib/supabase/auth-user'

// Общее число задач библиотеки — только для подписи «всего задач». Точный
// count по ~21k строк на каждое открытие страницы был самым долгим местом
// (при холодном кеше БД — секунды), а меняется число редко (импорт задач),
// поэтому кешируем его на 10 минут. После истечения срока следующий запрос
// сразу получает прошлое значение, а пересчёт идёт в фоне.
//
// Внутри unstable_cache нельзя читать cookies (сессию), поэтому считаем
// service-role клиентом с явным фильтром, повторяющим RLS-политику
// «library_problems: read global or own org»: активные задачи, общие
// (organization_id IS NULL) или своей организации. Роль teacher/admin уже
// гарантирует layout раздела /teacher. Ключ кеша — организация.
const getLibraryProblemCount = unstable_cache(
  async (orgId: string | null) => {
    let query = createAdminClient()
      .from('library_problems')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
    query = orgId
      ? query.or(`organization_id.is.null,organization_id.eq.${orgId}`)
      : query.is('organization_id', null)
    const { count } = await query
    return count ?? 0
  },
  ['library-problem-count'],
  { revalidate: 600, tags: ['library-problem-count'] }
)

export default async function LibraryPage() {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // Загружаем только канонические темы (ФИПИ КЭС) для фильтрации;
  // организация нужна как ключ кеша счётчика задач
  const [{ data: allTopics }, { data: profile }] = await Promise.all([
    supabase
      .from('library_topics')
      .select('id, exam_type, subject, grade, fipicod, name, parent_id, sort_order')
      .eq('is_canonical', true)
      .order('exam_type').order('subject').order('sort_order').order('fipicod'),
    supabase.from('profiles').select('organization_id').eq('id', user.id).single(),
  ])

  const totalProblems = await getLibraryProblemCount(profile?.organization_id ?? null)

  return (
    <div className="space-y-4">
      <AddTargetBanner />
      <LibraryClient
        initialTopics={allTopics ?? []}
        totalProblems={totalProblems}
      />
    </div>
  )
}
