import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// GET /api/library/problems
// Params: subject, exam_type, grade, canonical_topic_id (repeatable),
//         source, source_id, has_answer, site_domain, q, page, per_page
export async function GET(request: NextRequest) {
  const supabase = await createClient()

  // Single round-trip: getUser() uses the session cookie directly — no extra DB call
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch user + profile in one query
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const sp         = new URL(request.url).searchParams
  const subject    = sp.get('subject')
  const exam_type  = sp.get('exam_type')
  const grade      = sp.get('grade')
  const topicIds   = sp.getAll('canonical_topic_id').filter(Boolean)
  const source     = sp.get('source')       // 'all' | 'verified' | 'custom'
  const sourceId   = sp.get('source_id')
  const hasAnswer  = sp.get('has_answer')   // 'true' | 'false'
  const siteDomain = sp.get('site_domain')  // 'fipi' | 'sdamgia'
  const q          = sp.get('q')?.trim()
  const page       = Math.max(1, parseInt(sp.get('page') ?? '1'))
  const perPage    = Math.min(50, Math.max(1, parseInt(sp.get('per_page') ?? '20')))
  const from       = (page - 1) * perPage
  const to         = from + perPage - 1

  const orgId = profile.organization_id ?? ''
  const isCustomSource = source === 'custom' && !!orgId
  const isGlobalOnly   = source === 'verified' || !orgId

  // Build base query — select only columns the client needs
  let query = supabase
    .from('library_problems')
    .select(
      `id, source_id, source_domain, source_url,
       exam_type, task_number_type,
       prompt_text, prompt_html,
       correct_answer, answer_source, solution_html, library_code,
       canonical_topic:library_topics!canonical_topic_id ( id, fipicod, name )`,
      { count: 'exact' }
    )
    .eq('is_active', true)
    .order('scraped_at', { ascending: false, nullsFirst: false })
    .order('source_id',  { ascending: true })
    .range(from, to)

  // Organization scope — aligned with partial indexes (organization_id IS NULL)
  if (isCustomSource) {
    query = query.eq('organization_id', orgId)
  } else if (isGlobalOnly) {
    query = query.is('organization_id', null)
  } else {
    // 'all': global + own org
    query = orgId
      ? query.or(`organization_id.is.null,organization_id.eq.${orgId}`)
      : query.is('organization_id', null)
  }

  if (subject)            query = query.eq('subject',    subject)
  if (exam_type)          query = query.eq('exam_type',  exam_type)
  if (grade)              query = query.eq('grade',      grade)
  if (topicIds.length > 0) query = query.in('canonical_topic_id', topicIds)
  if (hasAnswer === 'true')  query = query.eq('has_answer', true)
  if (hasAnswer === 'false') query = query.eq('has_answer', false)
  if (siteDomain === 'fipi')    query = query.eq('source_domain', 'fipi.ru')
  if (siteDomain === 'sdamgia') query = query.ilike('source_domain', '%sdamgia%')

  if (sourceId?.trim()) {
    const code = sourceId.trim()
    // Digits only → source_id; mixed → library_code
    query = /[^\d]/.test(code)
      ? query.ilike('library_code', `%${code}%`)
      : query.eq('source_id', code)
  } else if (q) {
    query = query.textSearch('prompt_text', q, { config: 'russian' })
  }

  const { data, count, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const body = JSON.stringify({
    data:        data ?? [],
    total:       count ?? 0,
    page,
    per_page:    perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })

  // Cache public/verified library results for 30s on CDN, revalidate in background
  // Custom-org queries are user-specific — not cached
  const cacheHeader = isGlobalOnly && !sourceId && !q
    ? 'public, s-maxage=30, stale-while-revalidate=60'
    : 'private, no-store'

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheHeader,
    },
  })
}
