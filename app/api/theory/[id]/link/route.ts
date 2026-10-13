import { NextRequest } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { authorizeTestEdit, linkBlockToTest, requireTheoryStaff } from '@/lib/theory/access'

// POST /api/theory/[id]/link — подключить блок теории из библиотеки к
// тесту/ДЗ. Тело: { test_id }. Подключать может хозяин ДЗ (создатель или
// админ); блок — любой из библиотеки своей организации, не обязательно свой.
const bodySchema = z.object({ test_id: zUuid('Выберите задание') })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: blockId } = await params
  const staff = await requireTheoryStaff()
  if ('error' in staff) return staff.error

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const testId = parsed.data.test_id

  const { data: block } = await staff.admin
    .from('theory_blocks').select('organization_id').eq('id', blockId).maybeSingle()
  if (!block || block.organization_id !== staff.orgId) {
    return Response.json({ error: 'Теория не найдена' }, { status: 404 })
  }

  const testAuth = await authorizeTestEdit(staff, testId)
  if ('error' in testAuth) return testAuth.error

  const link = await linkBlockToTest(staff.admin, testId, blockId)
  if ('error' in link) return link.error
  return Response.json({ ok: true, sort_order: link.sortOrder, already: link.already })
}
