import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { TheoryBlock } from './types'

// Блоки теории теста в порядке показа. Клиент любой: страницы ученика
// передают пользовательский (RLS 098 отдаёт теорию только назначенных
// тестов), страница учителя — свой. Ошибка чтения не роняет страницу:
// теория вспомогательна, решать задания можно и без неё.
export async function loadTestTheory(
  client: SupabaseClient<Database>,
  testId: string,
): Promise<TheoryBlock[]> {
  const { data, error } = await client
    .from('test_theory_blocks')
    .select('sort_order, theory_blocks ( id, title, content_md, source_ref, updated_at )')
    .eq('test_id', testId)
    .order('sort_order', { ascending: true })
    .limit(20)

  if (error) {
    console.error('[theory] loadTestTheory failed:', error.message)
    return []
  }

  return (data ?? []).flatMap((row) => {
    const b = row.theory_blocks as unknown as Omit<TheoryBlock, 'sort_order'> | null
    return b ? [{ ...b, sort_order: row.sort_order }] : []
  })
}
