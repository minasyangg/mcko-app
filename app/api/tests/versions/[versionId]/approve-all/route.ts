import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyMatchingScoringRules } from '@/app/api/parsing/trigger/route'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('test_tasks')
    .update({ review_status: 'approved' })
    .eq('test_version_id', versionId)
    .eq('review_status', 'pending')
    .select('id')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Apply matching scoring rule max_scores after approval
  const admin = createAdminClient()
  const rulesApplied = await applyMatchingScoringRules(admin, versionId)

  return Response.json({ updated: data?.length ?? 0, rules_applied: rulesApplied })
}
