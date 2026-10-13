import { NextRequest } from 'next/server'
import { loadBlockForEdit, requireTheoryStaff, THEORY_COLUMNS } from '@/lib/theory/access'
import { theoryPatchSchema } from '@/lib/theory/schema'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/theory/[id] — правка блока теории (автор или админ). Блок мог
// быть подключён к нескольким ДЗ — правка видна во всех сразу.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const staff = await requireTheoryStaff()
  if ('error' in staff) return staff.error
  const access = await loadBlockForEdit(staff, id)
  if ('error' in access) return access.error

  const parsed = theoryPatchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  // undefined-поля не трогаем — частичная правка
  const update = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))

  const { data: block, error } = await staff.admin
    .from('theory_blocks')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(THEORY_COLUMNS)
    .single()
  if (error || !block) return Response.json({ error: error?.message ?? 'Update failed' }, { status: 500 })

  return Response.json({ block })
}

// DELETE /api/theory/[id] — удалить блок из библиотеки (автор или админ).
// Подключения к ДЗ снимаются каскадом (FK test_theory_blocks on delete
// cascade) — интерфейс заранее показывает, к скольким ДЗ блок подключён.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const staff = await requireTheoryStaff()
  if ('error' in staff) return staff.error
  const access = await loadBlockForEdit(staff, id)
  if ('error' in access) return access.error

  const { error } = await staff.admin.from('theory_blocks').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
