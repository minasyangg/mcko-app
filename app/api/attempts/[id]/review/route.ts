import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { loadAttemptReview } from '@/lib/attempts/review-data'

// GET — все данные окна проверки попытки (AttemptDrawer) одним запросом.
// Доступ решает RLS: запросы идут под сессией текущего пользователя, ровно
// те же, что раньше выполнялись из браузера (см. lib/attempts/review-data.ts).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params
  const supabase = await createClient()

  const { data: { user } } = await getAuthUser(supabase)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await loadAttemptReview(supabase, attemptId)
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
