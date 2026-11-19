import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeAssignmentOwner } from '@/lib/assignments/authorize'
import { addAttempts, MAX_ADD_ATTEMPTS } from '@/lib/assignments/attempts'

const schema = z.object({
  add: z.number().int().min(1, 'Добавьте хотя бы одну попытку').max(MAX_ADD_ATTEMPTS, `За раз — не больше ${MAX_ADD_ATTEMPTS} попыток`),
})

// POST /api/assignments/[id]/attempts — добавить попытки всем адресатам
// назначения (программа, группа или личное). Body: { add: number }.
// Ученики, у которых попытки кончились, снова могут решать; итог остаётся
// лучшим баллом по каждому заданию (см. lib/assignments/attempts.ts).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: assignmentId } = await params

  const auth = await authorizeAssignmentOwner(
    assignmentId,
    'Добавить попытки может только создатель назначения или администратор'
  )
  if ('error' in auth) return auth.error

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const result = await addAttempts(auth.admin, { assignmentId, add: parsed.data.add })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({
    ok: true,
    max_attempts: result.maxAttempts,
    reopened_students: result.reopenedStudents,
    closed_for_all: result.closedForAll,
    deadline_passed: result.deadlinePassed,
  })
}
