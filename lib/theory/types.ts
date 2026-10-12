// Модуль «Теория» (миграция 098): блок теории — markdown + KaTeX — живёт
// отдельно от заданий и подключается к тестам/ДЗ через test_theory_blocks.
// Задел на доработки: один блок на несколько ДЗ урока, привязка к теме
// программы и к параграфу книги (theory_blocks.book_id).

export interface TheoryBlock {
  id: string
  title: string
  /** Markdown + KaTeX ($…$, $$…$$) + GFM-таблицы — рендерится MarkdownContent */
  content_md: string
  /** Откуда выжимка: «Учебник, ч. 1, §1–10, с. 5–46» */
  source_ref: string | null
  sort_order: number
  updated_at: string
}

/** Ограничение размера одного блока — выжимка, а не учебник целиком */
export const THEORY_MAX_CHARS = 60_000
