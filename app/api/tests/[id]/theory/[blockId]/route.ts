import { NextRequest } from 'next/server'
import { authorizeTestEdit, requireTheoryStaff } from '@/lib/theory/access'

type Params = { params: Promise<{ id: string; blockId: string }> }

// DELETE /api/tests/[id]/theory/[blockId] — отключить блок теории от ДЗ.
// Сам блок остаётся в библиотеке («Библиотека → Теория»): удалить его можно
// только там (DELETE /api/theory/[id]). Правка блока — PATCH /api/theory/[id].
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: testId, blockId } = await params
  const staff = await requireTheoryStaff()
  if ('error' in staff) return staff.error
  const testAuth = await authorizeTestEdit(staff, testId)
  if ('error' in testAuth) return testAuth.error

  const { error } = await staff.admin
    .from('test_theory_blocks')
    .delete()
    .eq('test_id', testId)
    .eq('theory_block_id', blockId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
