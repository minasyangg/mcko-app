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

  // Fetch role from profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role

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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/auth).*)',
  ],
}
