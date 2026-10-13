import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { TestTheoryBlock, TheoryBlock, TheoryLibraryItem } from './types'

type Client = SupabaseClient<Database>

// Блоки теории теста в порядке показа. Клиент любой: страницы ученика
// передают пользовательский (RLS 098 отдаёт теорию только назначенных
// тестов), страница учителя — свой. Ошибка чтения не роняет страницу:
// теория вспомогательна, решать задания можно и без неё.
export async function loadTestTheory(client: Client, testId: string): Promise<TestTheoryBlock[]> {
  const { data, error } = await client
    .from('test_theory_blocks')
    .select('sort_order, theory_blocks ( id, title, content_md, source_ref, subject, grade, tags, summary, created_by, updated_at )')
    .eq('test_id', testId)
    .order('sort_order', { ascending: true })
    .limit(20)

  if (error) {
    console.error('[theory] loadTestTheory failed:', error.message)
    return []
  }

  return (data ?? []).flatMap((row) => {
    const b = row.theory_blocks as unknown as TheoryBlock | null
    return b ? [{ ...b, sort_order: row.sort_order }] : []
  })
}

// Каталог библиотеки «Теория» своей организации (RLS 098: персонал читает
// блоки своей org) — со счётчиком подключений к тестам. Блоков на школу —
// единицы-сотни, фильтрация идёт на клиенте по уже загруженному списку.
export async function loadTheoryLibrary(
  client: Client,
  viewer: { userId: string; role: string },
): Promise<TheoryLibraryItem[]> {
  const { data, error } = await client
    .from('theory_blocks')
    .select('id, title, content_md, source_ref, subject, grade, tags, summary, created_by, updated_at, test_theory_blocks(count)')
    .order('updated_at', { ascending: false })
    .limit(500)

  if (error) {
    console.error('[theory] loadTheoryLibrary failed:', error.message)
    return []
  }

  return (data ?? []).map((row) => {
    const { test_theory_blocks: links, ...block } = row as unknown as TheoryBlock & { test_theory_blocks: { count: number }[] | null }
    return {
      ...block,
      tags: block.tags ?? [],
      usage_count: links?.[0]?.count ?? 0,
      can_edit: viewer.role === 'admin' || block.created_by === viewer.userId,
    }
  })
}
