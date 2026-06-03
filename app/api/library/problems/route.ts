import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// GET /api/library/problems
// Params: subject, exam_type, grade, topic_id (repeatable), source, source_id, q, page, per_page
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const sp        = new URL(request.url).searchParams
  const subject   = sp.get('subject')
  const exam_type = sp.get('exam_type')
  const grade     = sp.get('grade')
  const topicIds  = sp.getAll('canonical_topic_id').filter(Boolean)
  const source    = sp.get('source')         // 'all' | 'verified' | 'custom'
  const sourceId  = sp.get('source_id')      // точный поиск по sdamgia ID
  const hasAnswer  = sp.get('has_answer')     // 'true' | 'false' | null
  const siteDomain = sp.get('site_domain')   // 'fipi' | 'sdamgia' | null
  const q         = sp.get('q')?.trim()
  const page      = Math.max(1, parseInt(sp.get('page') ?? '1'))
  const perPage   = Math.min(50, Math.max(1, parseInt(sp.get('per_page') ?? '20')))
  const from      = (page - 1) * perPage
  const to        = from + perPage - 1

  let query = supabase
    .from('library_problems')
    .select(`
      id, source_id, source_domain, source_url,
      exam_type, subject, grade,
      task_number_type, prompt_text, prompt_html, task_type,
      correct_answer, grading_method, default_max_score,
      has_answer, answer_source,
      organization_id,
      solution_html,
      topic_id, library_code,
      library_topics ( id, fipicod, name )
    `, { count: 'exact' })
    .eq('is_active', true)
    .order('used_count', { ascending: true })
    .order('source_id', { ascending: true })
    .range(from, to)

  const orgId = profile.organization_id ?? ''

  // Фильтр по источнику
  if (source === 'verified') {
    query = query.is('organization_id', null)
  } else if (source === 'custom' && orgId) {
    query = query.eq('organization_id', orgId)
  } else {
    // 'all' — глобальные + своей орг (если орг есть)
    query = orgId
      ? query.or(`organization_id.is.null,organization_id.eq.${orgId}`)
      : query.is('organization_id', null)
  }

  if (subject)   query = query.eq('subject', subject)
  if (exam_type) query = query.eq('exam_type', exam_type)
  if (grade)     query = query.eq('grade', grade)
  if (topicIds.length > 0) query = query.in('canonical_topic_id', topicIds)
  if (hasAnswer === 'true')  query = query.eq('has_answer', true)
  if (hasAnswer === 'false') query = query.eq('has_answer', false)
  if (siteDomain === 'fipi')    query = query.eq('source_domain', 'fipi.ru')
  if (siteDomain === 'sdamgia') query = query.ilike('source_domain', '%sdamgia%')

  // Поиск по коду задачи: library_code (ФИЗ-02210) или source_id (311672)
  if (sourceId?.trim()) {
    const code = sourceId.trim()
    if (/[^\d]/.test(code)) {
      // Содержит буквы — ищем по library_code
      query = query.ilike('library_code', `%${code}%`)
    } else {
      // Только цифры — ищем по source_id
      query = query.eq('source_id', code)
    }
  } else if (q) {
    query = query.textSearch('prompt_text', q, { config: 'russian' })
  }

  const { data, count, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({
    data:        data ?? [],
    total:       count ?? 0,
    page,
    per_page:    perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  })
}
