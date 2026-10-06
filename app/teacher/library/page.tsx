import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import { redirect } from 'next/navigation'
import { LibraryClient } from '@/components/teacher/LibraryClient'
import { AddTargetBanner } from '@/components/teacher/AddTargetBanner'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { examTypesOfSection, sectionOfExamTypes, type LibrarySection } from '@/lib/library/sections'

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
  async (orgId: string | null, section: LibrarySection) => {
    let query = createAdminClient()
      .from('library_problems')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .in('exam_type', examTypesOfSection(section))
    query = orgId
      ? query.or(`organization_id.is.null,organization_id.eq.${orgId}`)
      : query.is('organization_id', null)
    const { count } = await query
    return count ?? 0
  },
  ['library-problem-count'],
  { revalidate: 600, tags: ['library-problem-count'] }
)

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // Раздел меню: ?exam_type=A-Level — A-Level, всё остальное (в т.ч. без
  // параметра) — ОГЭ/ЕГЭ. Разделы не смешиваются: темы и счётчик — только свои.
  const examParam = (await searchParams).exam_type
  const section: LibrarySection = sectionOfExamTypes(
    Array.isArray(examParam) ? examParam : examParam ? [examParam] : []
  )

  // Загружаем только канонические темы (ФИПИ КЭС) для фильтрации;
  // организация нужна как ключ кеша счётчика задач
  const [{ data: allTopics }, { data: profile }] = await Promise.all([
    supabase
      .from('library_topics')
      .select('id, exam_type, subject, grade, fipicod, name, parent_id, sort_order')
      .eq('is_canonical', true)
      .in('exam_type', examTypesOfSection(section))
      .order('exam_type').order('subject').order('sort_order').order('fipicod'),
    supabase.from('profiles').select('organization_id').eq('id', user.id).single(),
  ])

  const totalProblems = await getLibraryProblemCount(profile?.organization_id ?? null, section)

  return (
    <div className="space-y-4">
      <AddTargetBanner />
      {/* key: тот же роут /teacher/library при переходе ОГЭ/ЕГЭ ↔ A-Level из
          меню не пересоздавал бы компонент — фильтры остались бы от старого
          раздела, и в «ОГЭ/ЕГЭ» продолжали бы показываться задачи A-Level */}
      <LibraryClient
        key={section}
        section={section}
        initialTopics={allTopics ?? []}
        totalProblems={totalProblems}
      />
    </div>
  )
}
