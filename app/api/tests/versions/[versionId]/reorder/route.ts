import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PUT /api/tests/versions/[versionId]/reorder
// Body: { task_ids: string[] } — новый порядок задач (полный список).
// Проставляет task_number и sort_order = позиция+1.
// Учитель у ученика видит порядок по sort_order, в редакторе — по task_number,
// поэтому обновляем оба поля синхронно.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Версия должна быть видима учителю (RLS) и не опубликована
  const { data: version } = await supabase
    .from('test_versions')
    .select('id, status')
    .eq('id', versionId)
    .single()
  if (!version) return Response.json({ error: 'Version not found' }, { status: 404 })
  if (version.status === 'published') {
    return Response.json({ error: 'Нельзя менять порядок в опубликованной версии' }, { status: 422 })
  }

  const body = await request.json().catch(() => ({}))
  const taskIds = body.task_ids as unknown
  if (!Array.isArray(taskIds) || taskIds.some(id => typeof id !== 'string')) {
    return Response.json({ error: 'task_ids required' }, { status: 400 })
  }

  // Все переданные id должны принадлежать этой версии и совпадать по составу
  const { data: existing } = await supabase
    .from('test_tasks')
    .select('id')
    .eq('test_version_id', versionId)
  const validIds = new Set((existing ?? []).map(t => t.id))
  if (taskIds.length !== validIds.size || !taskIds.every(id => validIds.has(id as string))) {
    return Response.json({ error: 'Список задач не совпадает с версией' }, { status: 400 })
  }

  // Уникальный индекс (test_version_id, task_number) не даёт менять номера
  // «в лоб» — сначала уводим все в отрицательный диапазон, затем ставим финал.
  // Пишем RLS-клиентом: политика разрешает учителю править только свои задачи.
  const ids = taskIds as string[]
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from('test_tasks')
      .update({ task_number: -(i + 1) })
      .eq('id', ids[i])
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from('test_tasks')
      .update({ task_number: i + 1, sort_order: i + 1 })
      .eq('id', ids[i])
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
