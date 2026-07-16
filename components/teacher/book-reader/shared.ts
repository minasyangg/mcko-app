import { visibleTaskNumber } from '@/lib/books/anchors'

// Общие типы и утилиты читалки книги (BookReader + формы редактирования).

export interface Book {
  id: string
  title: string
  authors: string | null
  subject: string
  grade: string | null
  level: string | null
  page_count: number | null
}

export interface Section {
  id: string
  parent_id: string | null
  kind: string
  number: string | null
  title: string
  page_start: number | null
  page_end: number | null
  sort_order: number
}

export interface PageData {
  page_index: number
  printed_page: number | null
  markdown: string
}

export interface ProblemAnchor {
  id: string
  task_number: string
  task_number_sort: number | null
  page_index: number
  md_start: number | null
  md_end: number | null
  prompt_md: string
  correct_answer: { text?: string } | null
  answer_source: string
  difficulty: string
  grading_method: string
  used_count: number
  has_images?: boolean
}

export interface SearchResult {
  id: string
  task_number: string
  section_id: string | null
  page_index: number
  answer_source: string
  snippet: string
}

// Методы автопроверки для ответов из книги (тот же набор, что в тестах)
export const gradingMethodLabel: Record<string, string> = {
  normalized: 'Нормализованное сравнение',
  exact: 'Точное совпадение',
  numeric_tolerance: 'Числовой (допуск)',
  sequence: 'Последовательность цифр (соответствие)',
  set_match: 'Совпадение набора',
  manual: 'Ручная проверка',
}

// ─── Номер задания ────────────────────────────────────────────────────────────
// В markdown страницы номер обязан оставаться (по нему строятся привязки и
// поиск), но пользователю он показывается только бейджем рамки. Из текста
// задания перед отображением и редактированием номер вырезается; при
// сохранении сервер восстанавливает его сам.
export function stripTaskNumber(md: string, taskNumber: string): string {
  // ДКР-задание «к1.2.3» в тексте напечатано видимым номером «3.»
  const esc = visibleTaskNumber(taskNumber).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // глиф-символ (○/∞/⑤/кружок-OCR) касается номера вплотную; глиф-буква
  // категории (Петерсон: К/П/Д/С — классная/повторение/дом/смекалка) —
  // через пробел; терминатор после номера («.»/«)») необязателен (Петерсон
  // печатает номер вообще без знака препинания: «23 Найди…»)
  return md.replace(
    new RegExp(`^[ \\t]*(?:(?:[^0-9A-Za-zА-Яа-яЁё#<\\s$([{]|[oOоОοΟ0])[ \\t]*|[КПДСKPDCπ][ \\t]+)?${esc}[*°]?(?:[.)][*°]?)?[ \\t]*`),
    '',
  )
}
