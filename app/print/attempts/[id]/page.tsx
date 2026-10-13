import { cache } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { loadAttemptPrint } from '@/lib/attempts/print-data'
import { AttemptPrintView } from '@/components/teacher/AttemptPrintView'

// Печатная версия попытки: условия заданий с картинками задания, ответ
// ученика (текстом) и правильный ответ. Открывается из окна «Попытка
// студента» в новой вкладке; PDF сохраняет браузер («Печать → Сохранить
// как PDF») — так формулы KaTeX, таблицы и картинки выходят ровно как на
// экране и текстом, а не картинкой.
//
// Путь вне /teacher намеренно: layout учителя добавил бы на лист меню.
// Поэтому доступ проверяется здесь: только персонал (ученик не должен видеть
// эталоны), а какие попытки видны — решает RLS, как в окне проверки.
const getData = cache(async (attemptId: string) => {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) return { kind: 'login' as const }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) return { kind: 'forbidden' as const }
  const data = await loadAttemptPrint(supabase, attemptId)
  return data ? { kind: 'ok' as const, data } : { kind: 'missing' as const }
})

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const res = await getData((await params).id)
  // заголовок вкладки браузер берёт именем файла при «Сохранить как PDF»
  return { title: res.kind === 'ok' ? `${res.data.studentName} — ${res.data.testTitle}` : 'Печать попытки' }
}

export default async function AttemptPrintPage({ params }: Params) {
  const res = await getData((await params).id)
  if (res.kind === 'login') redirect('/login')
  if (res.kind === 'forbidden') redirect('/student')
  if (res.kind === 'missing') {
    return <p className="p-8 text-sm text-muted-foreground">Попытка не найдена или нет доступа.</p>
  }
  return <AttemptPrintView data={res.data} />
}
