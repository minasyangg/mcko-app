import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authorizeTheoryEdit, isBlockLinkedToTest } from '@/lib/theory/access'
import { THEORY_MAX_CHARS } from '@/lib/theory/types'

type Params = { params: Promise<{ id: string; blockId: string }> }

// PATCH /api/tests/[id]/theory/[blockId] — правка блока теории теста.
// Блок может быть подключён и к другим тестам — правка видна везде, это и
// есть смысл общего блока.
const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content_md: z.string().max(THEORY_MAX_CHARS, `Теория длиннее ${THEORY_MAX_CHARS} символов — разбейте на несколько блоков`).optional(),
  source_ref: z.string().trim().max(300).nullable().optional(),
})

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: testId, blockId } = await params
  const auth = await authorizeTheoryEdit(testId)
  if ('error' in auth) return auth.error
  const { admin } = auth

  if (!(await isBlockLinkedToTest(admin, testId, blockId))) {
    return Response.json({ error: 'Блок теории не найден' }, { status: 404 })
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const update: { title?: string; content_md?: string; source_ref?: string | null; updated_at: string } = {
    updated_at: new Date().toISOString(),
  }
  if (parsed.data.title !== undefined) update.title = parsed.data.title
  if (parsed.data.content_md !== undefined) update.content_md = parsed.data.content_md
  if (parsed.data.source_ref !== undefined) update.source_ref = parsed.data.source_ref || null

  const { data: block, error } = await admin
    .from('theory_blocks')
    .update(update)
    .eq('id', blockId)
    .select('id, title, content_md, source_ref, updated_at')
    .single()
  if (error || !block) return Response.json({ error: error?.message ?? 'Update failed' }, { status: 500 })

  return Response.json({ block })
}

// DELETE /api/tests/[id]/theory/[blockId] — отключить блок от теста. Сам
// блок удаляется, только если больше ни к чему не подключён.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id: testId, blockId } = await params
  const auth = await authorizeTheoryEdit(testId)
  if ('error' in auth) return auth.error
  const { admin } = auth

  if (!(await isBlockLinkedToTest(admin, testId, blockId))) {
    return Response.json({ error: 'Блок теории не найден' }, { status: 404 })
  }

  const { error } = await admin
    .from('test_theory_blocks')
    .delete()
    .eq('test_id', testId)
    .eq('theory_block_id', blockId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { count } = await admin
    .from('test_theory_blocks')
    .select('test_id', { count: 'exact', head: true })
    .eq('theory_block_id', blockId)
  if ((count ?? 0) === 0) {
    await admin.from('theory_blocks').delete().eq('id', blockId)
  }

  return Response.json({ ok: true })
}
