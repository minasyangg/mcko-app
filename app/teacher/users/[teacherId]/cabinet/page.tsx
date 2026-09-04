import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Route, PenLine, BookOpen, Clock } from 'lucide-react'
import { getRoadmapDetail } from '@/lib/roadmaps/progress'
import { ProgramProgressView } from '@/components/teacher/ProgramProgressView'

function fmtDateTime(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU')
}

const TEST_STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  published: 'Опубликован',
  archived: 'В архиве',
}

// Read-only «кабинет» учителя для админа: программы (road map) с прогрессом
// учеников, доски учителя и созданные им тесты/задания. Расчёт прогресса —
// общий helper lib/roadmaps/progress.ts (тот же источник правды, что и в
// Мониторинге учителя: student_final_results + attempts, а не грубое
// checked/не-checked).
export default async function TeacherCabinetPage({ params }: { params: Promise<{ teacherId: string }> }) {
  const { teacherId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase.from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!me || me.role !== 'admin' || !me.organization_id) redirect('/teacher')

  const admin = createAdminClient()
  const { data: teacher } = await admin
    .from('profiles').select('id, full_name, role, organization_id').eq('id', teacherId).single()
  if (!teacher || teacher.role !== 'teacher' || teacher.organization_id !== me.organization_id) notFound()

  // Всё грузим одним заходом: программы, доски, тесты и последний вход.
  // login_events наполняется триггером на auth.sessions (см. /teacher/sessions),
  // поэтому это фактический вход в систему, а не косвенная активность.
  const [{ data: roadmapRows }, { data: boards }, { data: tests }, { data: lastLogin }] = await Promise.all([
    admin.from('roadmaps').select('id, title, subject').eq('created_by', teacherId).order('subject').order('title'),
    admin.from('doska_boards')
      .select('id, title, subject, created_at, updated_at, group_id, groups(name)')
      .eq('owner_id', teacherId).is('deleted_at', null)
      .order('updated_at', { ascending: false }),
    admin.from('tests')
      .select('id, title, subject, grade, exam_type, status, kind, created_at, updated_at')
      .eq('created_by', teacherId).eq('is_active', true)
      .order('created_at', { ascending: false }),
    admin.from('login_events')
      .select('created_at').eq('user_id', teacherId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  // Участники досок — чьи это занятия. Тот же join, что на /teacher/doska.
  const boardIds = (boards ?? []).map(b => b.id)
  const { data: parts } = boardIds.length
    ? await admin
        .from('doska_board_participants')
        .select('board_id, user_id, profiles!doska_board_participants_user_id_fkey(full_name)')
        .in('board_id', boardIds)
    : { data: [] as { board_id: string; user_id: string; profiles: { full_name: string | null } | null }[] }

  const studentsByBoard = new Map<string, string[]>()
  for (const p of (parts ?? []) as unknown as
       { board_id: string; profiles: { full_name: string | null } | null }[]) {
    const list = studentsByBoard.get(p.board_id) ?? []
    list.push(p.profiles?.full_name ?? 'ученик')
    studentsByBoard.set(p.board_id, list)
  }

  const details = (
    await Promise.all((roadmapRows ?? []).map(r => getRoadmapDetail(admin, r.id)))
  ).filter((d): d is NonNullable<typeof d> => !!d)

  const bySubject = new Map<string, typeof details>()
  for (const d of details) {
    const subj = d.subject?.trim() || 'Без предмета'
    const arr = bySubject.get(subj) ?? []
    arr.push(d)
    bySubject.set(subj, arr)
  }

  const lastActivity = fmtDateTime(lastLogin?.created_at ?? null)
  const boardRows = boards ?? []
  const testRows = tests ?? []

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <Button asChild variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-muted-foreground">
          <Link href="/teacher/users"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> К пользователям</Link>
        </Button>
        {/* ФИО и последний вход — в одной строке: админ открывает кабинет,
            чтобы понять «чем занимается и заходит ли вообще» */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold">Кабинет: {teacher.full_name}</h1>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {lastActivity
              ? <>Последний вход: <span className="font-medium text-foreground tabular-nums">{lastActivity}</span></>
              : 'Ни разу не входил'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Программы, доски и задания учителя (только просмотр)
        </p>
      </div>

      {/* ── Доски ── */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold border-b pb-1">
          <PenLine className="h-4 w-4 text-muted-foreground" />
          Доски
          {boardRows.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">{boardRows.length}</span>
          )}
        </h2>
        {boardRows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">Учитель не создавал досок.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-3 py-2 font-medium text-muted-foreground">Название</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">С кем</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Создана</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Изменена</th>
                </tr>
              </thead>
              <tbody>
                {boardRows.map(b => {
                  const group = (b as unknown as { groups: { name: string } | null }).groups?.name ?? null
                  const students = studentsByBoard.get(b.id) ?? []
                  return (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium">{b.title}</div>
                        {b.subject && (
                          <div className="text-xs text-muted-foreground">{b.subject}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {group
                          ? `Группа: ${group}`
                          : students.length > 0
                            ? students.join(', ')
                            : '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap tabular-nums">{fmtDate(b.created_at)}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap tabular-nums">{fmtDate(b.updated_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Тесты и задания ── */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold border-b pb-1">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          Задания и тесты
          {testRows.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">{testRows.length}</span>
          )}
        </h2>
        {testRows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">Учитель не создавал заданий.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-3 py-2 font-medium text-muted-foreground">Название</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Статус</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Создан</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Изменён</th>
                </tr>
              </thead>
              <tbody>
                {testRows.map(t => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/teacher/tests/${t.id}`} className="font-medium hover:underline">
                        {t.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {[
                          t.kind === 'homework' ? 'Домашнее задание' : 'Тест',
                          t.subject,
                          t.grade ? `${t.grade} кл.` : null,
                          t.exam_type,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={t.status === 'published' ? 'default' : 'secondary'}>
                        {TEST_STATUS_LABEL[t.status ?? ''] ?? t.status ?? '—'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap tabular-nums">{fmtDate(t.created_at)}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap tabular-nums">{fmtDate(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Программы ── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold border-b pb-1">
          <Route className="h-4 w-4 text-muted-foreground" />
          Программы
          {details.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">{details.length}</span>
          )}
        </h2>
        {details.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">У этого учителя пока нет программ.</p>
        ) : (
          [...bySubject.entries()].map(([subject, programs]) => (
            <div key={subject} className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">{subject}</h3>
              {programs.map(program => (
                <div key={program.id} className="rounded-md border">
                  <div className="px-4 py-2.5 border-b bg-muted/30 font-medium">{program.title}</div>
                  <div className="p-3">
                    <ProgramProgressView program={program} readOnly />
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </section>
    </div>
  )
}
