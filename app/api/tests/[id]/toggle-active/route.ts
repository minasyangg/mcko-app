import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch current value and verify ownership
  const { data: test } = await supabase
    .from('tests')
    .select('id, is_active, organization_id')
    .eq('id', id)
    .eq('organization_id', profile.organization_id ?? '')
    .single()

  if (!test) return Response.json({ error: 'Test not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('tests')
    .update({ is_active: !test.is_active })
    .eq('id', id)
    .select('id, is_active')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json(data)
}
