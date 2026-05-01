import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: job, error } = await supabase
      .from('parsing_jobs')
      .select('id, status, result_summary, error_message')
      .eq('id', id)
      .single()

    if (error || !job) {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }

    return Response.json({
      status: job.status,
      result_summary: job.result_summary,
      error_message: job.error_message,
    })
  } catch (err) {
    console.error('[parsing/jobs/[id]]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
