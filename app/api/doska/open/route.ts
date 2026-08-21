import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Единственная дверь на доску из mcko-app: GET, отдающий редирект, поэтому
// ссылки остаются обычными <a href> и одноразовый тикет не попадает в JS.
//
// Почему не пробросить access-токен, как раньше. Токен в адресной строке —
// это полноценный ключ от аккаунта: он оседает в истории и в Referer, живёт
// час и ничем не ограничен. Вместо этого доске выдаётся её СОБСТВЕННАЯ сессия
// через admin.generateLink: hashed_token уходит на doska серверным вызовом,
// оттуда возвращается короткий тикет, и только он едет в браузере. Своя сессия
// нужна ещё и потому, что ротация refresh-токенов включена — общий токен
// означал бы, что доска и mcko-app гасят сессии друг друга.
//
// ВАЖНО: generateLink вызывается ровно один раз на переход, а не на отрисовку
// списка ссылок: каждый вызов перезаписывает recovery_token пользователя, и из
// N сгенерированных подряд ссылок рабочей осталась бы только последняя.
// Побочный эффект, о котором стоит знать: переход на доску гасит неоткрытое
// письмо сброса пароля того же пользователя.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const boardId = url.searchParams.get('b') ?? ''
  const back = new URL('/', url.origin)

  /* Постоянный адрес доски.

     Раньше он брался только из переменной окружения, и стоило ей устареть —
     переход из кабинета обрывался на полпути: человек уходил в МЦКО, входил и
     оставался там же, потому что вернуть его было некуда. Адрес доски меняется
     раз в годы, а переменная живёт в чужой панели и о переезде не знает,
     поэтому держим его здесь.

     Переменную слушаем только когда она указывает на свою машину: там доска
     поднимается на localhost, и подменять его боевым адресом нельзя. */
  const DOSKA_SITE = 'https://tutpad.ru'
  const envUrl = process.env.DOSKA_URL?.replace(/\/+$/, '')
  const doskaUrl = envUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(envUrl)
    ? envUrl
    : DOSKA_SITE
  const ssoSecret = process.env.DOSKA_SSO_SECRET
  if (!doskaUrl || !ssoSecret) {
    return NextResponse.redirect(new URL('/?doska=not-configured', url.origin))
  }
  // Пустой b — это вход в саму доску без конкретного полотна: доска шлёт сюда
  // человека, у которого нет её сессии, чтобы не заставлять вводить пароль
  // второй раз. Дальше он попадёт в список своих досок.
  if (boardId && !/^[A-Za-z0-9_-]{1,40}$/.test(boardId)) {
    return NextResponse.redirect(new URL('/?doska=bad-board', url.origin))
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.redirect(new URL('/login?next=' + encodeURIComponent(url.pathname + url.search), url.origin))
  }

  // Доступ проверяет RLS: под клиентом пользователя строка видна только
  // владельцу, участнику и админу организации (см. 041_doska_boards.sql).
  if (boardId) {
    const { data: board } = await supabase
      .from('doska_boards')
      .select('id')
      .eq('id', boardId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!board) return NextResponse.redirect(new URL('/?doska=no-access', url.origin))
  }

  const admin = createAdminClient()
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  })
  const hashedToken = link?.properties?.hashed_token
  if (linkError || !hashedToken) {
    console.error('doska/open: generateLink', linkError?.message)
    return NextResponse.redirect(new URL('/?doska=sso-failed', url.origin))
  }

  let ticket: string | undefined
  try {
    const r = await fetch(doskaUrl + '/api/sso/ticket', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ssoSecret },
      body: JSON.stringify({ hashed_token: hashedToken }),
      signal: AbortSignal.timeout(10000),
    })
    if (r.ok) ticket = (await r.json())?.ticket
    else console.error('doska/open: тикет', r.status, await r.text())
  } catch (e) {
    console.error('doska/open: доска недоступна', (e as Error).message)
  }
  if (!ticket) return NextResponse.redirect(new URL('/?doska=offline', back.origin))

  return NextResponse.redirect(
    `${doskaUrl}/sso?ticket=${encodeURIComponent(ticket)}&b=${encodeURIComponent(boardId)}`
  )
}
