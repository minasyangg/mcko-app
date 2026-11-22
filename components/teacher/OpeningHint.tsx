'use client'

import { openingHint } from '@/lib/assignments/opening'
import { useAppSettings } from '@/components/shared/AppSettingsProvider'

/** Подсказка под полем «Открыть» — с расписанием рассылки из настроек системы */
export function OpeningHint({ deferred }: { deferred: boolean }) {
  const settings = useAppSettings()
  return <p className="text-xs text-muted-foreground">{openingHint(deferred, settings)}</p>
}
