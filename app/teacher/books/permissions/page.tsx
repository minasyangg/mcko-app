import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { BookPermissionsClient } from '@/components/teacher/BookPermissionsClient'

// Права доступа к книгам — только admin. Централизованно: для каждой книги
// какие учителя могут редактировать и удалять её. Просмотр остаётся общим.
export default async function BookPermissionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/teacher/books')

  const org = profile.organization_id || ''

  const [{ data: books }, { data: teachers }, { data: grants }] = await Promise.all([
    supabase
      .from('books')
      .select('id, title, authors, book_type, created_by')
      .eq('is_active', true)
      .order('title'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'teacher')
      .eq('organization_id', org)
      .order('full_name'),
    supabase.from('book_editors').select('book_id, teacher_id, can_delete'),
  ])

  // Владелец книги (если это учитель) — для отображения «владелец»
  const ownerNameById = new Map((teachers ?? []).map(t => [t.id, t.full_name]))

  const grantsByBook = new Map<string, { teacher_id: string; can_delete: boolean }[]>()
  for (const g of grants ?? []) {
    const arr = grantsByBook.get(g.book_id) ?? []
    arr.push({ teacher_id: g.teacher_id, can_delete: g.can_delete })
    grantsByBook.set(g.book_id, arr)
  }

  const booksWithGrants = (books ?? []).map(b => ({
    id: b.id,
    title: b.title,
    authors: b.authors,
    book_type: b.book_type,
    owner_id: b.created_by,
    owner_name: b.created_by ? (ownerNameById.get(b.created_by) ?? null) : null,
    grants: grantsByBook.get(b.id) ?? [],
  }))

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-muted-foreground">
          <Link href="/teacher/books"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> К книгам</Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Права доступа к книгам</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Просмотр книг и добавление их заданий в тест доступны всем учителям.
            Здесь настраивается, кто может <b>редактировать</b> и <b>удалять</b> книгу.
          </p>
        </div>
      </div>

      <BookPermissionsClient books={booksWithGrants} teachers={teachers ?? []} />
    </div>
  )
}
