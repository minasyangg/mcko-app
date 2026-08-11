import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PenLine } from 'lucide-react'

// Доски, куда ученика добавили участником (041_doska_boards.sql). У одного
// учителя их может быть несколько — по одной на предмет, поэтому предмет и
// вынесен на карточку: без него список выглядит как несколько одинаковых строк.

export default async function StudentBoardsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: rows } = await supabase
    .from('doska_board_participants')
    .select('board_id, doska_boards!inner(id, title, subject, updated_at, deleted_at, owner:profiles!doska_boards_owner_id_fkey(full_name))')
    .eq('user_id', user.id)
    .is('doska_boards.deleted_at', null)
    .order('updated_at', { referencedTable: 'doska_boards', ascending: false })

  const boards = (rows ?? []).map((r) => {
    const b = r.doska_boards as unknown as {
      title: string; subject: string | null; updated_at: string | null
      owner: { full_name: string | null } | null
    } | null
    return {
      id: r.board_id,
      title: b?.title ?? 'Доска',
      subject: b?.subject ?? null,
      updatedAt: b?.updated_at ?? null,
      teacher: b?.owner?.full_name ?? 'учитель',
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Мои доски</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Общие с учителем полотна. Открываются сразу — вводить пароль заново не нужно.
        </p>
      </div>

      {!boards.length ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center text-muted-foreground">
          <PenLine className="h-10 w-10 opacity-40" />
          <p>Вам пока не открыли ни одной доски.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <Card key={b.id} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">{b.title}</CardTitle>
                  {b.subject && <Badge variant="secondary" className="shrink-0">{b.subject}</Badge>}
                </div>
                <CardDescription>Ведёт {b.teacher}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-end gap-3 text-sm text-muted-foreground">
                {b.updatedAt && (
                  <p className="text-xs">
                    Последнее изменение: {new Date(b.updatedAt).toLocaleDateString('ru-RU')}
                  </p>
                )}
                {/* Ссылка ведёт через /api/doska/open: там ученику выдаётся его
                    собственная сессия доски, чтобы на полотне было видно, кто
                    именно пишет. Голая ссылка потребовала бы вводить пароль. */}
                <Button asChild size="sm" className="w-full">
                  <a href={`/api/doska/open?b=${b.id}`} target="_blank" rel="noopener noreferrer">
                    <PenLine className="h-4 w-4 mr-2" />
                    Открыть доску
                  </a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
