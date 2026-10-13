import { NextRequest } from 'next/server'
import { authorizeTestEdit, linkBlockToTest, requireTheoryStaff, THEORY_COLUMNS } from '@/lib/theory/access'
import { theoryCreateSchema } from '@/lib/theory/schema'

// POST /api/tests/[id]/theory — создать блок теории со страницы ДЗ: блок
// попадает в библиотеку (как и созданный там) и сразу подключается к этому
// ДЗ последним по порядку.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: testId } = await params
  const staff = await requireTheoryStaff()
  if ('error' in staff) return staff.error
  const testAuth = await authorizeTestEdit(staff, testId)
  if ('error' in testAuth) return testAuth.error

  const parsed = theoryCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const { data: block, error } = await staff.admin
    .from('theory_blocks')
    .insert({ ...parsed.data, tags: parsed.data.tags ?? [], organization_id: staff.orgId, created_by: staff.userId })
    .select(THEORY_COLUMNS)
    .single()
  if (error || !block) return Response.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

  const link = await linkBlockToTest(staff.admin, testId, block.id)
  if ('error' in link) {
    // блок без связи остался бы в библиотеке «ниоткуда» — создание откатываем
    await staff.admin.from('theory_blocks').delete().eq('id', block.id)
    return link.error
  }

  return Response.json({ block: { ...block, sort_order: link.sortOrder } }, { status: 201 })
}
