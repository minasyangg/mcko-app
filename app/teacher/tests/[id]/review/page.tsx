import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import ReviewBoard, {
  type TaskWithReview,
  type UnmatchedImageItem,
  type ParsingWarning,
} from '@/components/teacher/ReviewBoard'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ReviewPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: test, error: testError } = await supabase
    .from('tests')
    .select('id, title')
    .eq('id', id)
    .single()

  if (testError || !test) {
    notFound()
  }

  // Get the latest version that is in_review or draft (with done parsing job)
  const { data: versions } = await supabase
    .from('test_versions')
    .select('id, status, version_number')
    .eq('test_id', id)
    .in('status', ['draft', 'in_review'])
    .order('version_number', { ascending: false })
    .limit(1)

  const testVersion = versions?.[0]
  if (!testVersion) {
    notFound()
  }

  // Get the last done parsing job
  const { data: jobs } = await supabase
    .from('parsing_jobs')
    .select('id, status, result_summary, error_message')
    .eq('test_version_id', testVersion.id)
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(1)

  const parsingJob = jobs?.[0] ?? null

  // Load all tasks with answer keys
  const { data: rawTasks } = await supabase
    .from('test_tasks')
    .select(
      `
      id,
      task_number,
      title,
      prompt_text,
      prompt_html,
      task_type,
      review_status,
      parse_confidence,
      max_score,
      answer_format_hint,
      task_answer_keys ( correct_answer )
    `
    )
    .eq('test_version_id', testVersion.id)
    .order('task_number', { ascending: true })

  // Load task media
  const taskIds = rawTasks?.map((t) => t.id) ?? []

  const { data: mediaRows } = taskIds.length
    ? await supabase
        .from('task_media')
        .select('id, task_id, storage_path, placement, sort_order, alt_text, source_page')
        .in('task_id', taskIds)
    : { data: [] }

  // Generate signed URLs for media
  const mediaPaths = mediaRows?.map((m) => m.storage_path) ?? []
  const signedUrlMap: Record<string, string> = {}

  if (mediaPaths.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from('task-media')
      .createSignedUrls(mediaPaths, 3600)

    signedUrls?.forEach((item) => {
      if (item.signedUrl && item.path) {
        signedUrlMap[item.path] = item.signedUrl
      }
    })
  }

  // Load solution images from solution_media (for teacher review)
  const { data: solutionRows } = taskIds.length
    ? await supabase
        .from('task_solutions')
        .select('id, task_id')
        .in('task_id', taskIds)
    : { data: [] }

  const solutionIds = (solutionRows ?? []).map(s => s.id)
  const solTaskMap = new Map((solutionRows ?? []).map(s => [s.id, s.task_id]))

  const { data: solMediaRows } = solutionIds.length
    ? await supabase
        .from('solution_media')
        .select('id, solution_id, storage_path, sort_order')
        .in('solution_id', solutionIds)
    : { data: [] }

  const solMediaPaths = (solMediaRows ?? []).map(m => m.storage_path)
  const solUrlMap: Record<string, string> = {}
  if (solMediaPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('solution-media')
      .createSignedUrls(solMediaPaths, 3600)
    signed?.forEach(item => { if (item.signedUrl && item.path) solUrlMap[item.path] = item.signedUrl })
  }

  // Load unmatched images (task_id is null) — check both old and new path patterns
  const { data: unmatchedRaw } = await supabase
    .from('task_media')
    .select('id, storage_path, source_page')
    .is('task_id', null)
    .like('storage_path', `task-media/${testVersion.id}/%`)

  const unmatchedPaths = unmatchedRaw?.map((m) => m.storage_path) ?? []
  const unmatchedUrlMap: Record<string, string> = {}

  if (unmatchedPaths.length > 0) {
    const { data: unmatchedSigned } = await supabase.storage
      .from('task-media')
      .createSignedUrls(unmatchedPaths, 3600)

    unmatchedSigned?.forEach((item) => {
      if (item.signedUrl && item.path) {
        unmatchedUrlMap[item.path] = item.signedUrl
      }
    })
  }

  // Load warnings
  const { data: warningsRaw } = parsingJob
    ? await supabase
        .from('parsing_warnings')
        .select('id, warning_type, description, task_id')
        .eq('parsing_job_id', parsingJob.id)
        .eq('is_resolved', false)
    : { data: [] }

  // Build TaskWithReview[]
  const tasks: TaskWithReview[] = (rawTasks ?? []).map((t) => {
    const taskMedia = (mediaRows ?? [])
      .filter((m) => m.task_id === t.id)
      .map((m) => ({
        id: m.id,
        signedUrl: signedUrlMap[m.storage_path] ?? '',
        placement: m.placement ?? 'above_text',
        sort_order: m.sort_order ?? 0,
        alt_text: m.alt_text,
      }))

    const answerKey = Array.isArray(t.task_answer_keys)
      ? t.task_answer_keys[0]
      : t.task_answer_keys

    const correctAnswer = answerKey?.correct_answer
      ? typeof answerKey.correct_answer === 'string'
        ? answerKey.correct_answer
        : JSON.stringify(answerKey.correct_answer)
      : null

    // Solution media for this task (for teacher review in board)
    const solId = (solutionRows ?? []).find(s => s.task_id === t.id)?.id
    const solutionMedia = solId
      ? (solMediaRows ?? [])
          .filter(m => m.solution_id === solId)
          .map(m => ({
            id: m.id,
            signedUrl: solUrlMap[m.storage_path] ?? '',
            placement: 'above_text' as const,
            sort_order: m.sort_order ?? 0,
            alt_text: null,
          }))
      : []

    return {
      id: t.id,
      task_number: t.task_number,
      title: t.title,
      prompt_text: t.prompt_text,
      prompt_html: (t as any).prompt_html ?? null,
      task_type: t.task_type,
      review_status: t.review_status ?? 'pending',
      parse_confidence: t.parse_confidence,
      max_score: t.max_score ?? 1,
      answer_format_hint: t.answer_format_hint,
      correct_answer: correctAnswer,
      media: taskMedia,
      solutionMedia,
    }
  })

  const unmatchedImages: UnmatchedImageItem[] = (unmatchedRaw ?? []).map((img) => ({
    id: img.id,
    signedUrl: unmatchedUrlMap[img.storage_path] ?? '',
    source_page: img.source_page ?? 0,
  }))

  const warnings: ParsingWarning[] = (warningsRaw ?? []).map((w) => ({
    id: w.id,
    warning_type: w.warning_type,
    description: w.description,
    task_id: w.task_id,
  }))

  const canPublish =
    tasks.length > 0 &&
    tasks.every((t) => t.review_status === 'approved' || t.review_status === 'rejected')

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link href={`/teacher/tests/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад к тесту
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{test.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Проверка задач — версия {testVersion.version_number}
        </p>
      </div>

      <ReviewBoard
        testVersionId={testVersion.id}
        testId={id}
        tasks={tasks}
        unmatchedImages={unmatchedImages}
        warnings={warnings}
        canPublish={canPublish}
      />
    </div>
  )
}
