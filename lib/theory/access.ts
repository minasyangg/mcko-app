import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-user'

type AdminClient = ReturnType<typeof createAdminClient>

export interface TheoryStaff {
  admin: AdminClient
  userId: string
  orgId: string
  role: 'teacher' | 'admin'
}

type Fail = { error: Response }

const fail = (status: number, error: string): Fail => ({ error: Response.json({ error }, { status }) })

// Учитель или админ с организацией. Запись в теорию — service role: RLS-
// политик на запись у theory_blocks/test_theory_blocks нет (миграция 098),
// права проверяются здесь.
export async function requireTheoryStaff(): Promise<TheoryStaff | Fail> {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) return fail(401, 'Unauthorized')

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role) || !profile.organization_id) {
    return fail(403, 'Forbidden')
  }
  return {
    admin: createAdminClient(),
    userId: user.id,
    orgId: profile.organization_id,
    role: profile.role as 'teacher' | 'admin',
  }
}

// Подключать/отключать теорию у теста может тот, кто правит сам тест:
// создатель или админ его организации (как PATCH /api/tests/[id]).
export async function authorizeTestEdit(staff: TheoryStaff, testId: string): Promise<{ ok: true } | Fail> {
  const { data: test } = await staff.admin
    .from('tests').select('organization_id, created_by').eq('id', testId).maybeSingle()
  if (!test || test.organization_id !== staff.orgId) return fail(404, 'Test not found')
  if (staff.role !== 'admin' && test.created_by !== staff.userId) {
    return fail(403, 'Подключать теорию может только создатель задания или администратор')
  }
  return { ok: true }
}

// Сам блок — общий для школы (может стоять в чужих ДЗ), поэтому править и
// удалять его может только автор блока или админ, а не любой, к чьему ДЗ он
// подключён.
export function canEditBlock(staff: Pick<TheoryStaff, 'userId' | 'role'>, createdBy: string | null): boolean {
  return staff.role === 'admin' || (createdBy !== null && createdBy === staff.userId)
}

export async function loadBlockForEdit(staff: TheoryStaff, blockId: string): Promise<{ ok: true } | Fail> {
  const { data: block } = await staff.admin
    .from('theory_blocks').select('organization_id, created_by').eq('id', blockId).maybeSingle()
  if (!block || block.organization_id !== staff.orgId) return fail(404, 'Теория не найдена')
  if (!canEditBlock(staff, block.created_by)) {
    return fail(403, 'Править теорию может только её автор или администратор')
  }
  return { ok: true }
}

// Подключение блока к тесту последним по порядку. Повторное подключение того
// же блока — не ошибка, просто ничего не меняет.
export async function linkBlockToTest(
  admin: AdminClient, testId: string, blockId: string,
): Promise<{ sortOrder: number; already: boolean } | Fail> {
  const { data: existing } = await admin
    .from('test_theory_blocks').select('sort_order')
    .eq('test_id', testId).eq('theory_block_id', blockId).maybeSingle()
  if (existing) return { sortOrder: existing.sort_order, already: true }

  const { data: last } = await admin
    .from('test_theory_blocks').select('sort_order')
    .eq('test_id', testId).order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const sortOrder = (last?.sort_order ?? -1) + 1
  const { error } = await admin
    .from('test_theory_blocks')
    .insert({ test_id: testId, theory_block_id: blockId, sort_order: sortOrder })
  if (error) return fail(500, error.message)
  return { sortOrder, already: false }
}

export const THEORY_COLUMNS = 'id, title, content_md, source_ref, subject, grade, tags, summary, created_by, updated_at'
