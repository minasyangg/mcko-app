import { createClient } from '@/lib/supabase/server'

// GET — whitelist получателей текущего ученика (для диалога "Поделиться").
// RLS ("sss: student reads own", "ssr: student reads own") сам ограничивает
// выборку своими строками — явный student_id-фильтр не нужен.
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ enabled: false, recipients: [] }, { status: 401 })

  const [{ data: settings }, { data: recipients }] = await Promise.all([
    supabase
      .from('student_share_settings')
      .select('enabled')
      .eq('student_id', user.id)
      .maybeSingle(),
    supabase
      .from('student_share_recipients')
      .select('teacher_id, profiles!teacher_id(full_name)')
      .eq('student_id', user.id),
  ])

  return Response.json({
    enabled: settings?.enabled ?? false,
    recipients: (recipients ?? []).map(r => ({
      teacher_id: r.teacher_id,
      full_name: (r.profiles as unknown as { full_name: string } | null)?.full_name ?? '—',
    })),
  })
}
