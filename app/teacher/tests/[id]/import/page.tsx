import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import ImportFlow from './ImportFlow'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ImportPage({ params }: PageProps) {
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

  // Get the latest draft version
  const { data: versions } = await supabase
    .from('test_versions')
    .select('id, status, version_number')
    .eq('test_id', id)
    .eq('status', 'draft')
    .order('version_number', { ascending: false })
    .limit(1)

  const draftVersion = versions?.[0] ?? null

  if (!draftVersion) {
    // No draft version → redirect to test details
    redirect(`/teacher/tests/${id}`)
  }

  // Check for active parsing job
  const { data: jobs } = await supabase
    .from('parsing_jobs')
    .select('id, status')
    .eq('test_version_id', draftVersion.id)
    .in('status', ['queued', 'processing'])
    .order('created_at', { ascending: false })
    .limit(1)

  const existingJob = jobs?.[0] ? { id: jobs[0].id, status: jobs[0].status } : null

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <ImportFlow
        testVersionId={draftVersion.id}
        testId={id}
        testTitle={test.title}
        existingJob={existingJob}
      />
    </div>
  )
}
