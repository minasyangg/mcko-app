import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { enrichTaskMediaWithUrls } from '@/lib/media/signed-urls'
import { formatAnswerJsonRaw } from '@/lib/grading/format-answer-display'
import { formatCompositeAnswerForEdit } from '@/lib/grading/multi-part-answer'
import type { TestTask } from '@/components/teacher/TestDetailClient'
import type { TaskMedia } from '@/types/domain'

// GET /api/tests/[id]/preview — read-only состав теста/ДЗ (без ответов
// ученика) для TestPreviewModal, открываемой из списка программы.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: testId } = await params
  const supabase = await createClient()

  const { data: { user } } = await getAuthUser(supabase)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: test } = await supabase
    .from('tests')
    .select('id, title, organization_id, current_published_version_id')
    .eq('id', testId)
    .single()
  if (!test || test.organization_id !== profile.organization_id) {
    return Response.json({ error: 'Test not found' }, { status: 404 })
  }

  const { data: versions } = await supabase
    .from('test_versions')
    .select('id, status')
    .eq('test_id', testId)
    .order('version_number', { ascending: false })

  let workingVersion: { id: string; status: string } | null = null
  if (versions && versions.length > 0) {
    workingVersion = versions.find((v) => v.status === 'draft' || v.status === 'in_review') ?? null
    if (!workingVersion) {
      workingVersion = versions.find((v) => v.status === 'published') ?? null
    }
  }

  let tasks: TestTask[] = []

  if (workingVersion) {
    const { data: rawTasks } = await supabase
      .from('test_tasks')
      .select('*, task_answer_keys(correct_answer, grading_method)')
      .eq('test_version_id', workingVersion.id)
      .order('task_number', { ascending: true })

    if (rawTasks) {
      const taskIds = rawTasks.map(t => t.id)
      const { data: mediaRows } = taskIds.length > 0
        ? await supabase
            .from('task_media')
            .select('id, task_id, storage_path, media_type, original_filename, width_px, height_px, file_size_bytes, format, placement, sort_order, alt_text, source_page, source_bbox, is_manually_uploaded, created_at')
            .in('task_id', taskIds)
            .order('sort_order', { ascending: true })
        : { data: [] }

      const enriched = await enrichTaskMediaWithUrls(supabase, (mediaRows ?? []) as TaskMedia[])
      const mediaByTask: Record<string, typeof enriched> = {}
      for (const m of enriched) {
        if (!m.task_id) continue
        if (!mediaByTask[m.task_id]) mediaByTask[m.task_id] = []
        mediaByTask[m.task_id].push(m)
      }

      tasks = rawTasks.map((t) => {
        const key = (t as any).task_answer_keys
        return {
          id: t.id,
          task_number: t.task_number,
          sort_order: t.sort_order,
          prompt_text: t.prompt_text,
          prompt_html: t.prompt_html ?? null,
          task_type: t.task_type,
          options: t.options,
          answer_format_hint: t.answer_format_hint,
          max_score: t.max_score,
          review_status: t.review_status,
          parse_confidence: t.parse_confidence,
          correct_answer: key && key.correct_answer != null
            ? formatCompositeAnswerForEdit(key.correct_answer) ?? formatAnswerJsonRaw(key.correct_answer)
            : null,
          grading_method: (t as any).grading_method ?? 'normalized',
          images: mediaByTask[t.id] ?? [],
        } satisfies TestTask
      })
    }
  }

  return Response.json({ title: test.title, tasks })
}
