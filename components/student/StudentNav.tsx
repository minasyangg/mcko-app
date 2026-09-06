'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// «Мои тесты» и «Программа» объединены в табы на главной странице (/student)
// — назначение может прийти как обычный тест/ДЗ, так и через программу, и
// ученик должен видеть всё назначенное в одном месте, а не искать по разным
// разделам. «Мои доски» — отдельная функция, не назначение, остаётся
// самостоятельным пунктом.
//
// Клиентский компонент, а не часть layout.tsx: подсветка активного пункта
// нужна по текущему пути (usePathname), а layout — серверный.
const ITEMS = [
  { href: '/student', label: 'Мои задания' },
  { href: '/student/boards', label: 'Мои доски' },
]

export function StudentNav() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1 text-sm">
      {ITEMS.map((item) => {
        // «/student» активен и на своих подпутях (/student/attempt/...),
        // кроме «Мои доски» — сравнение по префиксу, не точное совпадение
        const isActive = item.href === '/student'
          ? pathname === '/student' || pathname.startsWith('/student/attempt')
          : pathname.startsWith(item.href)

        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              'px-2 py-1 rounded-md transition-colors ' +
              (isActive
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted')
            }
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
