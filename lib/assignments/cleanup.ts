import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

// Полное удаление назначений вместе с их попытками. Нужно, т.к.
// attempts.assignment_id и assignments.group_id — БЕЗ on delete cascade, а
// solution_requests.attempt_id тоже без каскада. Порядок: solution_requests →
// attempts (каскадом снимаются attempt_task_answers и presence_events) →
// assignments. Вызывается при отвязке теста от темы и удалении road map.
export async function deleteAssignmentsDeep(admin: AdminClient, assignmentIds: string[]) {
  if (assignmentIds.length === 0) return
  const { data: atts } = await admin
    .from('attempts').select('id').in('assignment_id', assignmentIds)
  const attemptIds = (atts ?? []).map(a => a.id)
  if (attemptIds.length > 0) {
    await admin.from('solution_requests').delete().in('attempt_id', attemptIds)
    await admin.from('attempts').delete().in('id', attemptIds)
  }
  await admin.from('assignments').delete().in('id', assignmentIds)
}
