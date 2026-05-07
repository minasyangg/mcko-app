import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { TestDetailClient } from '@/components/teacher/TestDetailClient'
import type { TestTask } from '@/components/teacher/TestDetailClient'

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
      tasks = rawTasks.map((t) => {
        const key = (t as any).task_answer_keys
        return {
          id: t.id,
          task_number: t.task_number,
          sort_order: t.sort_order,
          prompt_text: t.prompt_text,
          task_type: t.task_type,
          options: t.options,
          answer_format_hint: t.answer_format_hint,
          max_score: t.max_score,
          review_status: t.review_status,
          parse_confidence: t.parse_confidence,
          correct_answer: key ? String(key.correct_answer ?? '') || null : null,
          grading_method: key?.grading_method ?? null,
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
