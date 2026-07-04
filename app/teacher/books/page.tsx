import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BookOpen } from 'lucide-react'

const bookTypeLabel: Record<string, string> = {
  textbook: 'Учебник',
  problem_book: 'Задачник',
  workbook: 'Рабочая тетрадь',
  didactic: 'Дидактические материалы',
}

export default async function BooksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: books } = await supabase
    .from('books')
    .select('id, title, authors, book_type, subject, grade, level, page_count, import_meta')
    .eq('is_active', true)
    .order('subject')
    .order('grade')
    .order('title')

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Книги</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Учебники и задачники — база заданий для домашних работ и тестов
        </p>
      </div>

      {(!books || books.length === 0) && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3 text-muted-foreground">
          <BookOpen className="h-10 w-10" />
          <p>Книги ещё не загружены.</p>
          <p className="text-xs">Импорт выполняется локально: <code>node scripts/book-import.mjs &lt;file.json&gt;</code></p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(books ?? []).map((book) => {
          const meta = (book.import_meta ?? {}) as { problems?: number; answers_matched?: number }
          return (
            <Link key={book.id} href={`/teacher/books/${book.id}`}>
              <Card className="h-full hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <BookOpen className="h-8 w-8 text-primary/70 shrink-0" />
                    <Badge variant="outline" className="text-xs shrink-0">
                      {bookTypeLabel[book.book_type] ?? book.book_type}
                    </Badge>
                  </div>
                  <div>
                    <h2 className="font-medium leading-snug">{book.title}</h2>
                    {book.authors && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{book.authors}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{book.subject}</span>
                    {book.grade && <span>{book.grade} класс</span>}
                    {book.level && <span>{book.level}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground border-t pt-2">
                    {meta.problems != null && <span>Заданий: <span className="font-medium text-foreground">{meta.problems}</span></span>}
                    {meta.answers_matched != null && meta.answers_matched > 0 && (
                      <span>С ответами: <span className="font-medium text-foreground">{meta.answers_matched}</span></span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
