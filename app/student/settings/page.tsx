import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TelegramSettings } from '@/components/shared/TelegramSettings'
import { getBotUsername, telegramConfigured } from '@/lib/notifications/telegram'

export default async function StudentSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('telegram_username, telegram_chat_id, notifications_enabled')
    .eq('id', user.id)
    .single()

  const botUsername = telegramConfigured() ? await getBotUsername() : null

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Настройки</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Уведомления о новых заданиях и результатах проверки
        </p>
      </div>
      <TelegramSettings
        initialUsername={profile?.telegram_username ?? ''}
        connected={!!profile?.telegram_chat_id}
        botUsername={botUsername}
        notificationsEnabled={profile?.notifications_enabled ?? true}
      />
    </div>
  )
}
