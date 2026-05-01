'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import type { ComponentProps } from 'react'

type Props = Omit<ComponentProps<typeof Button>, 'onClick'>

export function LogoutButton({ children = 'Выйти', ...props }: Props) {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <Button variant="outline" size="sm" onClick={handleLogout} {...props}>
      {children}
    </Button>
  )
}
