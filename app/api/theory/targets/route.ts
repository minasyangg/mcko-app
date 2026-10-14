import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'

// GET /api/theory/targets — тесты и ДЗ, к которым можно подключить теорию
// (окно «Добавить теорию в ДЗ» в библиотеке). Читается на сервере под сессией
// пользователя — тот же путь, что у страниц, а не из браузера (см. GET
// /api/theory). Видимость — RLS: учитель видит свои, админ — тесты org;
// право подключать повторно проверяет POST /api/theory/[id]/link.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('tests')
    .select('id, title, kind, status')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ tests: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}
