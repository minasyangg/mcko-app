import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const SIGNED_URL_TTL = 3600
const ALLOWED_BUCKETS = ['task-media', 'solution-media'] as const
type AllowedBucket = (typeof ALLOWED_BUCKETS)[number]

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path')
  const bucket = searchParams.get('bucket') as AllowedBucket | null

  if (!path || !bucket) {
    return NextResponse.json({ error: 'Missing path or bucket' }, { status: 400 })
  }

  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL)

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to generate URL' }, { status: 500 })
  }

  return NextResponse.json(
    { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL * 1000 },
    {
      headers: {
        'Cache-Control': 'private, max-age=3000',
      },
    }
  )
}
