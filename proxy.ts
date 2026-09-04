import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request })
  const { pathname } = request.nextUrl

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Redirect unauthenticated users from protected routes
  if (!user) {
    if (pathname.startsWith('/student') || pathname.startsWith('/teacher')) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return response
  }

  // Роль нужна только для guarded-путей — на остальных не тратим запрос
  const needsRole =
    pathname.startsWith('/login') || pathname.startsWith('/register') ||
    pathname.startsWith('/student') || pathname.startsWith('/teacher')
  if (!needsRole) return response

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, moderation_status')
    .eq('id', user.id)
    .single()

  const role = profile?.role

  // Заявка с публичной регистрации (миграция 054) до подтверждения админом
  // не даёт доступа никуда: аккаунт в auth уже существует и человек может
  // войти по паролю, поэтому отсечка обязана быть здесь, а не только в UI.
  if (profile?.moderation_status === 'pending' || profile?.moderation_status === 'rejected') {
    if (pathname.startsWith('/register/pending')) return response
    return NextResponse.redirect(new URL('/register/pending', request.url))
  }

  // Redirect authenticated users away from auth pages
  if (pathname.startsWith('/login') || pathname.startsWith('/register')) {
    if (role === 'student') return NextResponse.redirect(new URL('/student', request.url))
    if (role === 'teacher' || role === 'admin') return NextResponse.redirect(new URL('/teacher', request.url))
  }

  // Guard student routes
  if (pathname.startsWith('/student') && role !== 'student') {
    return NextResponse.redirect(new URL('/teacher', request.url))
  }

  // Guard teacher routes
  if (pathname.startsWith('/teacher') && role !== 'teacher' && role !== 'admin') {
    return NextResponse.redirect(new URL('/student', request.url))
  }

  return response
}

export const config = {
  // /api/* исключён целиком: каждый роут сам аутентифицирует запрос
  // (getUser/authorize-хелперы), а прогон через proxy добавлял к каждому
  // API-вызову два лишних запроса к Supabase (getUser + profiles.role).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
}
