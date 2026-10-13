import { NextRequest } from 'next/server'
import { requireTheoryStaff, THEORY_COLUMNS } from '@/lib/theory/access'
import { theoryCreateSchema } from '@/lib/theory/schema'

// POST /api/theory — новый блок теории в библиотеке организации (без
// подключения к ДЗ). Тело: { title, content_md, subject?, grade?, tags?,
// summary?, source_ref? }; tags — массив или строка через запятую.
export async function POST(request: NextRequest) {
  const staff = await requireTheoryStaff()
  if ('error' in staff) return staff.error

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

  return Response.json({ block }, { status: 201 })
}
