import { NextRequest } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { authorizeTestEdit, linkBlockToTest, requireTheoryStaff, THEORY_COLUMNS } from '@/lib/theory/access'
import { theoryCreateSchema } from '@/lib/theory/schema'

// PATCH /api/tests/[id]/theory — порядок блоков теории в ДЗ (в нём ученик
// видит вкладки «1. …», «2. …»). Тело: { order: [blockId, …] } — все
// подключённые блоки в новом порядке.
const orderSchema = z.object({ order: z.array(zUuid()).min(1).max(20) })

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: testId } = await params
  const staff = await requireTheoryStaff()
  if ('error' in staff) return staff.error
  const testAuth = await authorizeTestEdit(staff, testId)
  if ('error' in testAuth) return testAuth.error

  const parsed = orderSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid body' }, { status: 400 })

  const { data: linked } = await staff.admin
    .from('test_theory_blocks').select('theory_block_id').eq('test_id', testId).limit(50)
  const linkedIds = new Set((linked ?? []).map((l) => l.theory_block_id))
  const order = parsed.data.order
  if (order.length !== linkedIds.size || !order.every((id) => linkedIds.has(id))) {
    return Response.json({ error: 'Список блоков устарел — обновите страницу' }, { status: 409 })
  }

  const results = await Promise.all(order.map((blockId, i) =>
    staff.admin.from('test_theory_blocks').update({ sort_order: i }).eq('test_id', testId).eq('theory_block_id', blockId)))
  const failed = results.find((r) => r.error)
  if (failed?.error) return Response.json({ error: failed.error.message }, { status: 500 })
  return Response.json({ ok: true })
}

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
