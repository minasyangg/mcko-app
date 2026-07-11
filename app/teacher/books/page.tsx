import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ShieldCheck } from 'lucide-react'
import { BooksCatalog, type CatalogBook } from '@/components/teacher/BooksCatalog'

export default async function BooksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = profile?.role === 'admin'

  const { data: books } = await supabase
    .from('books')
    .select('id, title, authors, book_type, subject, grade, level, page_count, import_meta')
    .eq('is_active', true)
    .order('subject')
    .order('grade')
    .order('title')

  const catalog: CatalogBook[] = (books ?? []).map(b => {
    const meta = (b.import_meta ?? {}) as { problems?: number; answers_matched?: number }
    return {
      id: b.id,
      title: b.title,
      authors: b.authors,
      book_type: b.book_type,
      subject: b.subject,
      grade: b.grade,
      level: b.level,
      problems: meta.problems ?? null,
      answers_matched: meta.answers_matched ?? null,
    }
  })

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Книги</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Учебники и задачники — база заданий для домашних работ и тестов
          </p>
        </div>
        {isAdmin && (
          <Button asChild variant="outline" size="sm">
            <Link href="/teacher/books/permissions">
              <ShieldCheck className="h-4 w-4 mr-1.5" />
              Права доступа
            </Link>
          </Button>
        )}
      </div>

      <BooksCatalog books={catalog} />
    </div>
  )
}
