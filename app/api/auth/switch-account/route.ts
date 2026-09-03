import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import {
  SWITCHABLE_ACCOUNTS, findSwitchable, isSwitchAllowed, requiresPassword,
} from '@/lib/auth/switch-accounts'

// Быстрое переключение между двумя аккаунтами одного человека.
// Модель безопасности и список разрешённых id — в lib/auth/switch-accounts.ts.
//
// Коротко: админ→учитель пускаем без пароля (прав не прибавляется),
// учитель→админ — только с паролем, иначе пароль учителя стал бы ключом от
// админки. Пароль проверяется обычным signInWithPassword, то есть тем же
// путём, что и на странице входа — своей проверки паролей мы не изобретаем.

/** Достаёт cookie запроса в формате, который ждёт createServerClient. */
function cookiesFromRequest(request: Request) {
  const header = request.headers.get('cookie')
  if (!header) return []
  return header.split('; ').map(c => {
    const i = c.indexOf('=')
    return { name: c.slice(0, i), value: c.slice(i + 1) }
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as
    { target_id?: string; password?: string } | null
  const targetId = typeof body?.target_id === 'string' ? body.target_id : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!isSwitchAllowed(user.id, targetId)) {
    return NextResponse.json({ error: 'Переключение недоступно' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Профиль цели читаем service-role: под текущим пользователем RLS может его
  // не отдать (учитель не обязан видеть админа).
  const { data: target } = await admin
    .from('profiles')
    .select('id, full_name, role, is_active, deleted_at')
    .eq('id', targetId)
    .single()

  if (!target || target.deleted_at || target.is_active === false) {
    return NextResponse.json({ error: 'Аккаунт недоступен' }, { status: 404 })
  }

  const { data: targetAuth } = await admin.auth.admin.getUserById(targetId)
  const targetEmail = targetAuth?.user?.email
  if (!targetEmail) {
    return NextResponse.json({ error: 'У аккаунта нет email' }, { status: 400 })
  }

  const needPassword = requiresPassword(user.id, targetId)
  if (needPassword && !password) {
    return NextResponse.json(
      { error: 'Требуется пароль', requires_password: true },
      { status: 401 }
    )
  }

  // Ответ создаём заранее: клиент ниже пишет cookie новой сессии именно в него,
  // поэтому старая сессия заменяется атомарно, без промежуточного разлогина.
  const response = NextResponse.json({
    ok: true,
    full_name: target.full_name,
    role: target.role,
  })

  const sessionClient = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookiesFromRequest(request),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  if (needPassword) {
    // Обычный вход по паролю — тот же путь, что и на странице входа.
    const { error } = await sessionClient.auth.signInWithPassword({
      email: targetEmail,
      password,
    })
    if (error) {
      return NextResponse.json(
        { error: 'Неверный пароль', requires_password: true },
        { status: 401 }
      )
    }
  } else {
    // Понижение роли (админ→учитель): сессию выдаём через generateLink +
    // verifyOtp на своём сервере — hashed_token не покидает бэкенд.
    // Побочный эффект generateLink (как и в doska/open): вызов перезаписывает
    // recovery_token целевого пользователя, поэтому неоткрытое письмо сброса
    // пароля у него перестанет действовать.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: targetEmail,
    })
    const hashedToken = link?.properties?.hashed_token
    if (linkError || !hashedToken) {
      console.error('switch-account: generateLink', linkError?.message)
      return NextResponse.json({ error: 'Не удалось переключиться' }, { status: 500 })
    }

    const { error: verifyError } = await sessionClient.auth.verifyOtp({
      type: 'magiclink',
      token_hash: hashedToken,
    })
    if (verifyError) {
      console.error('switch-account: verifyOtp', verifyError.message)
      return NextResponse.json({ error: 'Не удалось переключиться' }, { status: 500 })
    }
  }

  // Журнал: механизм пускает в чужой аккаунт, каждый переход должен быть виден.
  // Ошибка записи не фатальна — переключение уже произошло.
  const { error: logError } = await admin.from('auth_switch_log').insert({
    from_user_id: user.id,
    to_user_id: targetId,
    with_password: needPassword,
  })
  if (logError) console.error('switch-account: log', logError.message)

  return response
}

// Список аккаунтов, доступных текущему пользователю для переключения.
// Пустой массив — для всех, кого нет в белом списке: кнопка просто не рисуется.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !findSwitchable(user.id)) {
    return NextResponse.json({ accounts: [] })
  }

  const accounts = SWITCHABLE_ACCOUNTS
    .filter(a => a.id !== user.id)
    .map(a => ({
      id: a.id,
      label: a.label,
      role: a.role,
      requires_password: requiresPassword(user.id, a.id),
    }))

  return NextResponse.json({ accounts })
}
