import { createClient } from '@/lib/supabase/server'

// Удаление доски учителем. Мягкое: содержимое и картинки лежат в файловом
// хранилище самой доски, и физическое удаление строки оставило бы их сиротами,
// а восстановить занятие было бы уже нечем.
//
// Права не проверяются здесь намеренно: update по doska_boards разрешён
// политикой только владельцу (041), поэтому чужая доска просто не найдётся.

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
    return Response.json({ error: 'Неверный адрес доски' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('doska_boards')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('doska-boards: удаление', error.message)
    return Response.json({ error: 'Не удалось удалить доску' }, { status: 500 })
  }
  if (!data) return Response.json({ error: 'Доска не найдена' }, { status: 404 })

  return Response.json({ ok: true })
}
