import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-user'

type AdminClient = ReturnType<typeof createAdminClient>

export type TheoryEditAuth =
  | { admin: AdminClient; userId: string; orgId: string }
  | { error: Response }

// Править теорию теста может тот же, кто правит сам тест: создатель теста
// или админ его организации (то же правило, что у PATCH /api/tests/[id]).
// Запись идёт service role — RLS-политик на запись у theory_blocks нет.
export async function authorizeTheoryEdit(testId: string): Promise<TheoryEditAuth> {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role) || !profile.organization_id) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = createAdminClient()
  const { data: test } = await admin
    .from('tests').select('id, organization_id, created_by').eq('id', testId).maybeSingle()
  if (!test || test.organization_id !== profile.organization_id) {
    return { error: Response.json({ error: 'Test not found' }, { status: 404 }) }
  }
  if (profile.role !== 'admin' && test.created_by !== user.id) {
    return { error: Response.json({ error: 'Править теорию может только создатель теста или администратор' }, { status: 403 }) }
  }

  return { admin, userId: user.id, orgId: profile.organization_id }
}

// Блок подключён к этому тесту? Правка/удаление идут «через тест», чтобы
// проверка прав (владелец теста) была одной и той же для всех операций.
export async function isBlockLinkedToTest(admin: AdminClient, testId: string, blockId: string): Promise<boolean> {
  const { data } = await admin
    .from('test_theory_blocks')
    .select('theory_block_id')
    .eq('test_id', testId)
    .eq('theory_block_id', blockId)
    .maybeSingle()
  return !!data
}
