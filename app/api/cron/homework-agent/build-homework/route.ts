import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildHomework } from '@/lib/homework-agent/build'

// Фаза 2 автогенератора ДЗ: подбирает все homework_proposals со
// status='confirmed' и достраивает их. Обычно сборка запускается сразу из
// callback-обработчика Telegram (этап 3 плана — inline-кнопки, ещё не
// реализован) или из PATCH-роута страницы подтверждения — этот cron лишь
// страховка на случай, если тот вызов не прошёл (сетевой сбой, учитель
// подтвердил через сайт, пока прямой вызов сборки не подключён).
//
// buildHomework сама атомарно захватывает предложение (confirmed→building) —
// повторный запуск этого cron безопасен, не задвоит сборку.
//
// Vercel Cron вызывает GET (vercel.json), POST оставлен для ручной проверки.
export const maxDuration = 120

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'cron not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const { data: pending } = await admin
      .from('homework_proposals')
      .select('id')
      .eq('status', 'confirmed')

    const results = []
    for (const p of pending ?? []) {
      results.push({ proposalId: p.id, result: await buildHomework(admin, p.id) })
    }

    const summary = {
      built: results.filter(r => r.result.ok).length,
      failed: results.filter(r => !r.result.ok).length,
    }
    return Response.json({ ok: true, summary, results })
  } catch (err) {
    console.error('[cron/homework-agent/build-homework]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
