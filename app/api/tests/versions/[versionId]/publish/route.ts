import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { publishTestVersion } from '@/lib/tests/publish'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const { versionId } = await params
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

    const result = await publishTestVersion(supabase, versionId, user.id)
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

    return Response.json({ success: true })
  } catch (err) {
    console.error('[versions/[versionId]/publish]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
