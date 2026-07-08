import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

// Управление точечными грантами на редактирование книги (book_editors).
// Строго admin. Запись идёт через service role — RLS на book_editors
// закрыт для клиентской записи.

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin' || !profile.organization_id) return null
  return { userId: user.id, organizationId: profile.organization_id }
}

async function getBook(admin: ReturnType<typeof createAdminClient>, bookId: string) {
  const { data: book } = await admin
    .from('books').select('id, organization_id').eq('id', bookId).single()
  return book
}

// GET /api/books/[id]/editors — список грантов книги
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookId } = await params
  const ctx = await verifyAdmin()
  if (!ctx) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const book = await getBook(admin, bookId)
  if (!book) return Response.json({ error: 'Book not found' }, { status: 404 })
  if (book.organization_id !== null && book.organization_id !== ctx.organizationId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: editors } = await admin
    .from('book_editors')
    .select('teacher_id, granted_by, created_at')
    .eq('book_id', bookId)

  return Response.json({ editors: editors ?? [] })
}

// POST /api/books/[id]/editors — выдать грант. Body: { teacher_id }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookId } = await params
  const ctx = await verifyAdmin()
  if (!ctx) return Response.json({ error: 'Выдавать доступ может только администратор' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { teacher_id?: string }
  if (!body.teacher_id) return Response.json({ error: 'teacher_id required' }, { status: 400 })

  const admin = createAdminClient()
  const book = await getBook(admin, bookId)
  if (!book) return Response.json({ error: 'Book not found' }, { status: 404 })
  if (book.organization_id !== null && book.organization_id !== ctx.organizationId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Грант — только учителю своей организации
  const { data: teacher } = await admin
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', body.teacher_id)
    .single()
  if (!teacher || teacher.role !== 'teacher' || teacher.organization_id !== ctx.organizationId) {
    return Response.json({ error: 'Учитель не найден в вашей организации' }, { status: 422 })
  }

  const { error } = await admin.from('book_editors').upsert({
    book_id: bookId,
    teacher_id: body.teacher_id,
    granted_by: ctx.userId,
  }, { onConflict: 'book_id,teacher_id' })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true }, { status: 201 })
}

// DELETE /api/books/[id]/editors?teacher_id=... — отозвать грант
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookId } = await params
  const ctx = await verifyAdmin()
  if (!ctx) return Response.json({ error: 'Отзывать доступ может только администратор' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const teacherId = searchParams.get('teacher_id')
  if (!teacherId) return Response.json({ error: 'teacher_id required' }, { status: 400 })

  const admin = createAdminClient()
  const book = await getBook(admin, bookId)
  if (!book) return Response.json({ error: 'Book not found' }, { status: 404 })
  if (book.organization_id !== null && book.organization_id !== ctx.organizationId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await admin
    .from('book_editors')
    .delete()
    .eq('book_id', bookId)
    .eq('teacher_id', teacherId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
