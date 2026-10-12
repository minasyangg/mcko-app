import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authorizeTheoryEdit } from '@/lib/theory/access'
import { THEORY_MAX_CHARS } from '@/lib/theory/types'

// POST /api/tests/[id]/theory — создать блок теории и подключить к тесту
// последним по порядку. Тело: { title?, content_md, source_ref? }.
const createSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content_md: z.string().max(THEORY_MAX_CHARS, `Теория длиннее ${THEORY_MAX_CHARS} символов — разбейте на несколько блоков`),
  source_ref: z.string().trim().max(300).nullable().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: testId } = await params
  const auth = await authorizeTheoryEdit(testId)
  if ('error' in auth) return auth.error
  const { admin, userId, orgId } = auth

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const { data: last } = await admin
    .from('test_theory_blocks')
    .select('sort_order')
    .eq('test_id', testId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: block, error } = await admin
    .from('theory_blocks')
    .insert({
      organization_id: orgId,
      title: parsed.data.title ?? 'Теория',
      content_md: parsed.data.content_md,
      source_ref: parsed.data.source_ref || null,
      created_by: userId,
    })
    .select('id, title, content_md, source_ref, updated_at')
    .single()
  if (error || !block) return Response.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

  const sortOrder = (last?.sort_order ?? -1) + 1
  const { error: linkError } = await admin
    .from('test_theory_blocks')
    .insert({ test_id: testId, theory_block_id: block.id, sort_order: sortOrder })
  if (linkError) {
    // блок без связи никому не виден — убираем, чтобы не копить сирот
    await admin.from('theory_blocks').delete().eq('id', block.id)
    return Response.json({ error: linkError.message }, { status: 500 })
  }

  return Response.json({ block: { ...block, sort_order: sortOrder } }, { status: 201 })
}
