import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { StorageUrlProvider } from '@/components/shared/StorageUrlProvider'
import { RU_PROXY_HEADER } from '@/lib/supabase/ru-proxy'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'ExamPlatform',
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
        <StorageUrlProvider viaRuProxy={viaRuProxy}>{children}</StorageUrlProvider>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  )
}
