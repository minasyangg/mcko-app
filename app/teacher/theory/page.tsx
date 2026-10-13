import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { loadTheoryLibrary } from '@/lib/theory/load'
import { TheoryLibraryClient } from '@/components/theory/TheoryLibraryClient'
import { AddTargetBanner } from '@/components/teacher/AddTargetBanner'

// «Библиотека → Теория»: каталог блоков теории организации (миграции 098–099).
// Отдельный путь, а не /teacher/library/theory: пункты меню библиотеки
// подсвечиваются по префиксу /teacher/library, и «Теория» горела бы вместе
// с «ОГЭ/ЕГЭ».
export default async function TheoryLibraryPage() {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const items = await loadTheoryLibrary(supabase, { userId: user.id, role: profile?.role ?? 'teacher' })

  return (
    <div className="space-y-4">
      <AddTargetBanner />
      <TheoryLibraryClient initialItems={items} />
    </div>
  )
}
