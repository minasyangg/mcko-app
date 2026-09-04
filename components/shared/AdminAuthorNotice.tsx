'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

/**
 * Напоминание админу, что созданный им материал будет числиться за
 * административным аккаунтом, а не за учителем.
 *
 * Не запрет, а именно напоминание — по решению пользователя: админ имеет право
 * создавать материалы, но на практике почти всегда это делается «за учителя», и
 * потом владельца приходится править руками в БД (так было с ДЗ
 * «Мех|Кинематика|Задачи-1»). Автору тест виден в его «Моих заданиях», от
 * автора же считается доступ на редактирование.
 *
 * Роль спрашиваем у сервера, а не принимаем пропсом: компонент вставляется в
 * клиентские формы, которые роль не загружают, и дублировать этот запрос в
 * каждой из них было бы лишним.
 */
export function AdminAuthorNotice({ what = 'материал' }: { what?: string }) {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles').select('role').eq('id', user.id).single()
      if (!cancelled && data?.role === 'admin') setIsAdmin(true)
    })()
    return () => { cancelled = true }
  }, [])

  if (!isAdmin) return null

  return (
    <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-900 dark:bg-amber-950/40">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="text-amber-900 dark:text-amber-200">
        Вы вошли как <b>администратор</b>. {what.charAt(0).toUpperCase() + what.slice(1)} будет
        числиться за административным аккаунтом, а не за учителем.
        <div className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">
          Если это материал учителя — переключитесь на его аккаунт (кнопка рядом с именем в меню).
        </div>
      </div>
    </div>
  )
}
