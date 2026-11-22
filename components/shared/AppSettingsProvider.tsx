'use client'

import { createContext, useContext } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '@/lib/settings/registry'

// Настройки системы (114) для браузерных компонентов. Значения кладут
// серверные layout учителя и ученика (getAppSettings); вне провайдера —
// значения по умолчанию, то есть прежнее поведение.
const AppSettingsContext = createContext<AppSettings>(DEFAULT_SETTINGS)

export function AppSettingsProvider({ value, children }: { value: AppSettings; children: React.ReactNode }) {
  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>
}

export function useAppSettings(): AppSettings {
  return useContext(AppSettingsContext)
}
