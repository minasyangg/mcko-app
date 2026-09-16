import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { proposeForDueRules } from '@/lib/homework-agent/propose'

// Фаза 1 автогенератора ДЗ (project_homework_agent): раз в сутки Vercel Cron
// (vercel.json) дёргает этот роут GET-запросом (так вызывает cron сам
// Vercel — не POST); сам роут внутри проверяет weekdays/send_at_local
// каждого правила — «2 раза в неделю» работает при ежедневном расписании
// cron. На dev-preview (Vercel Cron бежит только на production) вызывать
// вручную (GET тоже принимается — тот же handler):
//   curl https://<preview>/api/cron/homework-agent/propose \
//     -H "Authorization: Bearer $CRON_SECRET"
export const maxDuration = 60

async function handle(request: NextRequest) {
  // fail-closed по образцу app/api/telegram/webhook: без секрета роут не
  // работает вовсе, а не молча пропускает проверку.
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'cron not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 })
  }

  try {
    const admin = createAdminClient()

    // Просроченные pending-предложения — не строим ДЗ, о которых учитель не
    // узнал (уехал на выходные и т.п.), просто закрываем как expired.
    const { data: expiredRows } = await admin
      .from('homework_proposals')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString())
      .select('id')

    const results = await proposeForDueRules(admin)
    const summary = {
      expired: expiredRows?.length ?? 0,
      created: results.filter(r => r.outcome === 'created').length,
      skipped_conflict: results.filter(r => r.outcome === 'skipped_conflict').length,
      skipped_no_candidate: results.filter(r => r.outcome === 'skipped_no_candidate').length,
      skipped_no_topic_link: results.filter(r => r.outcome === 'skipped_no_topic_link').length,
    }
    return Response.json({ ok: true, summary, results })
  } catch (err) {
    console.error('[cron/homework-agent/propose]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
