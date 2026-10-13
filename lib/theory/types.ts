// Модуль «Теория» (миграции 098–099): блок теории — markdown + KaTeX — живёт
// в библиотеке отдельно от заданий (предмет, класс, теги) и подключается к
// любым тестам/ДЗ через test_theory_blocks. Отключение от ДЗ блок не удаляет,
// удаление из библиотеки снимает его со всех ДЗ.

export interface TheoryBlock {
  id: string
  title: string
  /** Markdown + KaTeX ($…$, $$…$$) + GFM-таблицы — рендерится MarkdownContent */
  content_md: string
  /** Откуда выжимка: «Учебник, ч. 1, §1–10, с. 5–46» */
  source_ref: string | null
  subject: string | null
  grade: string | null
  /** Ключевые темы для фильтра, в нижнем регистре */
  tags: string[]
  /** Одна-две строки для карточки библиотеки */
  summary: string | null
  created_by: string | null
  updated_at: string
}

/** Блок в составе ДЗ — с порядком показа */
export interface TestTheoryBlock extends TheoryBlock {
  sort_order: number
}

/** Блок в каталоге библиотеки */
export interface TheoryLibraryItem extends TheoryBlock {
  /** К скольким тестам/ДЗ подключён */
  usage_count: number
  /** Автор или админ — может править и удалять */
  can_edit: boolean
}

/** Ограничение размера одного блока — выжимка, а не учебник целиком */
export const THEORY_MAX_CHARS = 60_000
export const THEORY_MAX_TAGS = 20

// Теги из поля ввода «медиана, Размах ,  медиана» → ['медиана', 'размах']:
// нижний регистр и без повторов — иначе фильтр библиотеки делил бы один тег
// на несколько.
export function normalizeTags(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(',')
  const seen = new Set<string>()
  for (const t of list) {
    const tag = t.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 40)
    if (tag) seen.add(tag)
  }
  return [...seen].slice(0, THEORY_MAX_TAGS)
}

// Начало текста для карточки, если краткое описание не заполнено: без
// разметки, формулы заменены на «…», чтобы в превью не торчал LaTeX.
export function theoryExcerpt(md: string, max = 220): string {
  const plain = md
    .replace(/\$\$[\s\S]*?\$\$/g, ' … ')
    .replace(/\$[^$\n]*\$/g, '…')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>|`]/g, ' ')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? plain.slice(0, max).trimEnd() + '…' : plain
}
