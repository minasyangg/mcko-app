import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { authorizeAssignmentOwner } from '@/lib/assignments/authorize'
import { updateCumulativeResult } from '@/lib/grading/finalize'
import { notifyAssignmentCreated } from '@/lib/notifications/send'
import { isValidConductedOn, offlineAttemptMoment } from '@/lib/assignments/offline'
import { openedAt } from '@/lib/assignments/opening'
import { joinedTooLate } from '@/lib/settings/registry'
import { getAppSettings } from '@/lib/settings/server'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

// Результаты очной работы (assignments.mode = 'offline', миграция 116).
// Учитель вносит баллы по заданиям за учеников программы — они пишутся
// обычной попыткой (attempts.is_offline, статус checked) и обычными
// attempt_task_answers, итог — через updateCumulativeResult. Поэтому
// статистика и прогресс программы учитывают очную работу без своей ветки.
//
// «Не был» — отметка в assignment_absences: попытки нет, а ученику
// открывается тест онлайн (check_attempt_startable пускает только их).
// Ученик, уже начавший или сдавший работу онлайн, здесь не редактируется —
// его результат живёт своей попыткой.

const authorize = (assignmentId: string) =>
  authorizeAssignmentOwner(assignmentId, 'Вносить результаты может только создатель назначения или администратор')

type Ctx = {
  assignment: {
    id: string
    mode: string
    conducted_on: string | null
    ends_at: string | null
    group_id: string | null
    test_version_id: string
    created_at: string | null
    starts_at: string | null
    title: string
    /** отсутствовавшие могут написать на сайте (у работы «только баллы», 117, — нечего) */
    makeup: boolean
  }
  tasks: { id: string; task_number: number; max_score: number }[]
  roster: { id: string; full_name: string }[]
}

async function loadContext(admin: AdminClient, assignmentId: string): Promise<Ctx | null> {
  const { data: a } = await admin
    .from('assignments')
    .select('id, mode, conducted_on, ends_at, group_id, test_version_id, created_at, starts_at, test_versions!test_version_id(tests!test_id(title, scores_only))')
    .eq('id', assignmentId)
    .single()
  if (!a) return null

  const [{ data: tasks }, { data: members }, settings] = await Promise.all([
    admin.from('test_tasks')
      .select('id, task_number, max_score')
      .eq('test_version_id', a.test_version_id)
      .order('sort_order', { ascending: true }),
    a.group_id
      ? admin.from('group_members')
          .select('added_at, profiles!user_id(id, full_name, role)')
          .eq('group_id', a.group_id)
      : Promise.resolve({ data: [] as { added_at: string | null; profiles: unknown }[] }),
    getAppSettings(),
  ])

  // Тот же круг учеников, что видит назначение (правило позднего
  // вступления, 058/110): опоздавшему в группу работа не видна — и вносить
  // за него нечего.
  const opened = openedAt(a)
  const roster = (members ?? [])
    .filter(m => !joinedTooLate(m.added_at, opened, settings.late_join_days))
    .map(m => m.profiles as { id: string; full_name: string; role: string } | null)
    .filter((p): p is { id: string; full_name: string; role: string } => p != null && p.role === 'student')
    .map(p => ({ id: p.id, full_name: p.full_name }))
    .sort((x, y) => x.full_name.localeCompare(y.full_name, 'ru'))

  return {
    assignment: {
      id: a.id,
      mode: a.mode,
      conducted_on: a.conducted_on,
      ends_at: a.ends_at,
      group_id: a.group_id,
      test_version_id: a.test_version_id,
      created_at: a.created_at,
      starts_at: a.starts_at,
      title: (a.test_versions as { tests?: { title?: string } } | null)?.tests?.title ?? 'Тест',
      makeup: !(a.test_versions as { tests?: { scores_only?: boolean } } | null)?.tests?.scores_only,
    },
    tasks: (tasks ?? []).map(t => ({ id: t.id, task_number: t.task_number, max_score: Number(t.max_score ?? 1) })),
    roster,
  }
}

// Попытки назначения: очные — для таблицы, онлайн — чтобы не трогать тех,
// кто уже писал на сайте.
async function loadAttempts(admin: AdminClient, assignmentId: string) {
  const [{ data: attempts }, { data: absences }] = await Promise.all([
    admin.from('attempts')
      .select('id, student_id, status, score, max_score, is_offline, submitted_at, created_at')
      .eq('assignment_id', assignmentId)
      .in('status', ['in_progress', 'not_started', 'submitted', 'checked'])
      .order('created_at', { ascending: false }),
    admin.from('assignment_absences').select('student_id').eq('assignment_id', assignmentId),
  ])
  const offlineByStudent = new Map<string, string>()
  const onlineByStudent = new Map<string, { status: string; score: number | null; max_score: number | null; submitted_at: string | null }>()
  for (const t of attempts ?? []) {
    if (t.is_offline) {
      if (!offlineByStudent.has(t.student_id)) offlineByStudent.set(t.student_id, t.id)
    } else if (!onlineByStudent.has(t.student_id)) {
      onlineByStudent.set(t.student_id, { status: t.status, score: t.score, max_score: t.max_score, submitted_at: t.submitted_at })
    }
  }
  return {
    offlineByStudent,
    onlineByStudent,
    absent: new Set((absences ?? []).map(a => a.student_id)),
  }
}

// GET — таблица для ввода: задания, ученики, уже внесённые баллы и «н».
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: assignmentId } = await params
  const auth = await authorize(assignmentId)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const ctx = await loadContext(admin, assignmentId)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ctx.assignment.mode !== 'offline') {
    return NextResponse.json({ error: 'Это не очная работа' }, { status: 400 })
  }

  const { offlineByStudent, onlineByStudent, absent } = await loadAttempts(admin, assignmentId)

  const offlineIds = [...offlineByStudent.values()]
  const { data: answers } = offlineIds.length
    ? await admin.from('attempt_task_answers').select('attempt_id, task_id, awarded_score').in('attempt_id', offlineIds)
    : { data: [] as { attempt_id: string | null; task_id: string | null; awarded_score: number | null }[] }
  const scoresByAttempt = new Map<string, Record<string, number>>()
  for (const ans of answers ?? []) {
    if (!ans.attempt_id || !ans.task_id) continue
    const rec = scoresByAttempt.get(ans.attempt_id) ?? {}
    rec[ans.task_id] = Number(ans.awarded_score ?? 0)
    scoresByAttempt.set(ans.attempt_id, rec)
  }

  return NextResponse.json({
    assignment: {
      id: ctx.assignment.id,
      title: ctx.assignment.title,
      conducted_on: ctx.assignment.conducted_on,
      ends_at: ctx.assignment.ends_at,
      makeup: ctx.assignment.makeup,
    },
    tasks: ctx.tasks,
    students: ctx.roster.map(s => {
      const offlineId = offlineByStudent.get(s.id)
      return {
        id: s.id,
        full_name: s.full_name,
        absent: absent.has(s.id),
        scores: offlineId ? (scoresByAttempt.get(offlineId) ?? {}) : null,
        online: onlineByStudent.get(s.id) ?? null,
      }
    }),
  })
}

const putSchema = z.object({
  conducted_on: z.string().optional(),
  rows: z.array(z.object({
    student_id: zUuid(),
    absent: z.boolean(),
    // null / отсутствие ключа — ячейка пустая
    scores: z.record(z.string(), z.number().nullable()),
  })).max(500),
})

// PUT — сохранить таблицу целиком (строки только переданных учеников).
// Строка без единого балла и без «н» — «результат не внесён»: очная попытка,
// если была, удаляется. Пустые ячейки в заполненной строке — 0 баллов.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: assignmentId } = await params
  const auth = await authorize(assignmentId)
  if ('error' in auth) return auth.error
  const { admin, userId } = auth

  const parsed = putSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const body = parsed.data

  const ctx = await loadContext(admin, assignmentId)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ctx.assignment.mode !== 'offline') {
    return NextResponse.json({ error: 'Это не очная работа' }, { status: 400 })
  }
  if (body.conducted_on !== undefined && !isValidConductedOn(body.conducted_on)) {
    return NextResponse.json({ error: 'Некорректная дата проведения' }, { status: 400 })
  }
  if (ctx.tasks.length === 0) {
    return NextResponse.json({ error: 'В тесте нет заданий' }, { status: 400 })
  }

  const rosterById = new Map(ctx.roster.map(s => [s.id, s]))
  const maxByTask = new Map(ctx.tasks.map(t => [t.id, t.max_score]))
  const totalMax = ctx.tasks.reduce((s, t) => s + t.max_score, 0)

  // Проверка всех строк ДО записи — иначе ошибка в середине оставила бы
  // таблицу сохранённой наполовину.
  for (const row of body.rows) {
    const student = rosterById.get(row.student_id)
    if (!student) return NextResponse.json({ error: 'Ученик не относится к этой работе' }, { status: 400 })
    if (row.absent) continue
    for (const [taskId, v] of Object.entries(row.scores)) {
      const max = maxByTask.get(taskId)
      if (max === undefined) return NextResponse.json({ error: 'Задание не относится к этому тесту' }, { status: 400 })
      if (v != null && (!Number.isFinite(v) || v < 0 || v > max)) {
        return NextResponse.json({ error: `${student.full_name}: балл должен быть от 0 до ${max}` }, { status: 400 })
      }
    }
  }

  const conductedOn = body.conducted_on ?? ctx.assignment.conducted_on
  if (!conductedOn) return NextResponse.json({ error: 'Укажите дату проведения' }, { status: 400 })
  const moment = offlineAttemptMoment(conductedOn)
  const now = new Date().toISOString()

  const { offlineByStudent, onlineByStudent, absent } = await loadAttempts(admin, assignmentId)

  // Дата сменилась — переносим и уже внесённые очные попытки, иначе в
  // статистике они остались бы на старом дне
  if (conductedOn !== ctx.assignment.conducted_on) {
    await admin.from('assignments').update({ conducted_on: conductedOn }).eq('id', assignmentId)
    if (offlineByStudent.size > 0) {
      await admin.from('attempts')
        .update({ started_at: moment, submitted_at: moment, checked_at: moment, last_activity_at: moment })
        .in('id', [...offlineByStudent.values()])
    }
  }

  const changed = new Set<string>()
  const newlyAbsent: string[] = []
  const skipped: string[] = []

  async function deleteOfflineAttempt(studentId: string) {
    const attemptId = offlineByStudent.get(studentId)
    if (!attemptId) return
    // solution_requests ссылается на попытку без каскада; ответы и фото — с каскадом
    await admin.from('solution_requests').delete().eq('attempt_id', attemptId)
    await admin.from('attempts').delete().eq('id', attemptId)
    offlineByStudent.delete(studentId)
    changed.add(studentId)
  }

  for (const row of body.rows) {
    const sid = row.student_id
    // Уже писал онлайн (или пишет сейчас) — его результат не перезаписываем
    if (onlineByStudent.has(sid)) {
      skipped.push(rosterById.get(sid)!.full_name)
      continue
    }

    if (row.absent) {
      if (!absent.has(sid)) {
        const { error } = await admin.from('assignment_absences')
          .insert({ assignment_id: assignmentId, student_id: sid, marked_by: userId })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        newlyAbsent.push(sid)
      }
      await deleteOfflineAttempt(sid)
      continue
    }

    if (absent.has(sid)) {
      await admin.from('assignment_absences').delete().eq('assignment_id', assignmentId).eq('student_id', sid)
    }

    const filled = ctx.tasks.some(t => row.scores[t.id] != null)
    if (!filled) {
      await deleteOfflineAttempt(sid)
      continue
    }

    const perTask = ctx.tasks.map(t => ({ task: t, score: row.scores[t.id] ?? 0 }))
    const score = perTask.reduce((s, x) => s + x.score, 0)

    let attemptId = offlineByStudent.get(sid)
    if (attemptId) {
      const { error } = await admin.from('attempts')
        .update({ score, max_score: totalMax, teacher_reviewed_at: now })
        .eq('id', attemptId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { data: created, error } = await admin.from('attempts').insert({
        assignment_id: assignmentId,
        student_id: sid,
        status: 'checked',
        is_offline: true,
        started_at: moment,
        submitted_at: moment,
        checked_at: moment,
        last_activity_at: moment,
        score,
        max_score: totalMax,
        submitted_late: false,
        teacher_reviewed_at: now,
      }).select('id').single()
      if (error || !created) return NextResponse.json({ error: error?.message ?? 'Не удалось сохранить' }, { status: 500 })
      attemptId = created.id
      offlineByStudent.set(sid, attemptId)
    }

    // is_correct = полный балл, блокировка — тоже от полного балла (как при
    // ручной проверке, см. api/attempts/[id]/grade)
    const { error: ansError } = await admin.from('attempt_task_answers').upsert(
      perTask.map(({ task, score: s }) => ({
        attempt_id: attemptId!,
        task_id: task.id,
        answer_json: null,
        awarded_score: s,
        is_correct: s >= task.max_score,
        is_locked: s >= task.max_score,
        teacher_checked_at: now,
        updated_at: now,
      })),
      { onConflict: 'attempt_id,task_id' },
    )
    if (ansError) return NextResponse.json({ error: ansError.message }, { status: 500 })
    changed.add(sid)
  }

  // Итог по назначению — единственной формулой. Ученику без единой
  // завершённой попытки строку итога не оставляем: «0 из N» в статистике
  // означал бы, что он писал и получил ноль.
  // Принудительное закрытие и архив — «липкие», такую строку не трогаем.
  for (const sid of changed) {
    const res = await updateCumulativeResult(admin, assignmentId, sid)
    if (res && res.attemptCount === 0 && res.closedReason === null) {
      await admin.from('student_final_results').delete()
        .eq('assignment_id', assignmentId).eq('student_id', sid)
    }
  }

  // Отмеченным «н» — обычное «назначен тест» с пояснением: без него ученик
  // не узнает, что пропущенную работу надо написать на сайте. У работы
  // «только баллы» писать на сайте нечего — «н» остаётся просто отметкой
  if (newlyAbsent.length > 0 && ctx.assignment.makeup) {
    after(() => notifyAssignmentCreated(assignmentId, { studentIds: newlyAbsent, conductedOn }))
  }

  return NextResponse.json({ ok: true, saved: changed.size, skipped })
}
