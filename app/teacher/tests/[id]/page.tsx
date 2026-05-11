import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { TestDetailClient } from '@/components/teacher/TestDetailClient'
import type { TestTask } from '@/components/teacher/TestDetailClient'
import { enrichTaskMediaWithUrls } from '@/lib/media/signed-urls'
import type { TaskMedia } from '@/types/domain'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TestDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: test, error } = await supabase
    .from('tests')
    .select('id, title, subject, grade, exam_type, description, status, is_active')
    .eq('id', id)
    .single()

  if (error || !test) {
    notFound()
  }

  // Find the working version: prefer draft/in_review, fallback to published
  const { data: versions } = await supabase
    .from('test_versions')
    .select('id, status')
    .eq('test_id', id)
    .order('version_number', { ascending: false })

  let workingVersion: { id: string; status: string } | null = null

  if (versions && versions.length > 0) {
    // 1. Prefer draft or in_review (editable)
    workingVersion =
      versions.find((v) => v.status === 'draft' || v.status === 'in_review') ?? null

    // 2. Fallback to published
    if (!workingVersion) {
      workingVersion = versions.find((v) => v.status === 'published') ?? null
    }
  }

  const canEdit = workingVersion != null && workingVersion.status !== 'published'

  // Load tasks for the working version
  let tasks: TestTask[] = []

  if (workingVersion) {
    const { data: rawTasks } = await supabase
      .from('test_tasks')
      .select('*, task_answer_keys(correct_answer, grading_method)')
      .eq('test_version_id', workingVersion.id)
      .order('task_number', { ascending: true })

    if (rawTasks) {
      // Load signed URLs for task images
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
          correct_answer: key ? String(key.correct_answer ?? '') || null : null,
          grading_method: key?.grading_method ?? null,
          images: mediaByTask[t.id] ?? [],
        } satisfies TestTask
      })
    }
  }

  return (
    <TestDetailClient
      testId={id}
      test={{
        title: test.title,
        subject: test.subject,
        grade: test.grade,
        exam_type: test.exam_type,
        description: test.description,
        status: test.status,
        is_active: test.is_active,
      }}
      versionId={workingVersion?.id ?? null}
      versionStatus={workingVersion?.status ?? null}
      tasks={tasks}
      canEdit={canEdit}
    />
  )
}
