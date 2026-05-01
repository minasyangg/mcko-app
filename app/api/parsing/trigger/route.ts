import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile || !['teacher', 'admin'].includes(profile.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { test_version_id, doc_ids } = body as {
      test_version_id: string
      doc_ids: string[]
    }

    if (!test_version_id || !Array.isArray(doc_ids) || doc_ids.length === 0) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    const { data: job, error: jobError } = await adminClient
      .from('parsing_jobs')
      .insert({
        test_version_id,
        status: 'queued',
      })
      .select('id')
      .single()

    if (jobError || !job) {
      return Response.json(
        { error: jobError?.message || 'Failed to create parsing job' },
        { status: 500 }
      )
    }

    // Fire and forget — invoke edge function without awaiting
    const edgeClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    edgeClient.functions
      .invoke('process-pdf', {
        body: { job_id: job.id, test_version_id, doc_ids },
      })
      .catch(console.error)

    return Response.json({ job_id: job.id })
  } catch (err) {
    console.error('[parsing/trigger]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
