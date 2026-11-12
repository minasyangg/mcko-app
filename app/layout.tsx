import type { Metadata } from 'next'
import { Suspense } from 'react'
import { headers } from 'next/headers'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { StorageUrlProvider } from '@/components/shared/StorageUrlProvider'
import { NavigationProgress } from '@/components/shared/NavigationProgress'
import { RU_PROXY_HEADER } from '@/lib/supabase/ru-proxy'
import './globals.css'

// cyrillic обязателен: интерфейс на русском, а без этого набора кириллица
// рисовалась бы запасным системным шрифтом рядом с латиницей и цифрами в Geist
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'cyrillic'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin', 'cyrillic'],
})

export const metadata: Metadata = {
  // Страницы задают своё короткое название (export const metadata = { title })
  // — во вкладке и в истории браузера оно встаёт перед названием сайта
  title: { default: 'ExamPlatform', template: '%s · ExamPlatform' },
  description: 'Платформа компьютерного тестирования для школьников',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Страница открыта через прокси в РФ — картинки Storage отдаём через него же
  // (lib/supabase/ru-proxy.ts).
  const viaRuProxy = (await headers()).get(RU_PROXY_HEADER) === '1'
  return (
    <html lang="ru" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* useSearchParams внутри — без Suspense статическая сборка страницы падает */}
        <Suspense fallback={null}><NavigationProgress /></Suspense>
        <StorageUrlProvider viaRuProxy={viaRuProxy}>{children}</StorageUrlProvider>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  )
}
