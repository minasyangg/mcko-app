import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { requireTheoryStaff, THEORY_COLUMNS } from '@/lib/theory/access'
import { theoryCreateSchema } from '@/lib/theory/schema'

// GET /api/theory — каталог теории организации для окна «Теория из
// библиотеки» на странице ДЗ. Раньше окно читало theory_blocks прямо из
// браузера, и у учителя список бывал пустым, хотя страница библиотеки (она
// грузится на сервере) блоки показывала. Теперь окно берёт список на сервере
// под сессией пользователя (RLS: персонал своей org).
// Облегчённый: без текста блоков (content_md — десятки КБ на блок с
// разборами); текст подключённого блока возвращает POST /api/theory/[id]/link.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { data, error } = await supabase
    .from('theory_blocks')
    .select('id, title, source_ref, subject, grade, tags, summary, created_by, updated_at')
    .order('updated_at', { ascending: false })
    .limit(500)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const items = (data ?? []).map((b) => ({ ...b, tags: b.tags ?? [] }))
  return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}

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
