// Диспетчер модулей парсинга готового PaddleOCR-JSON по типу экзамена.
// Тип экзамена уже выбран учителем при создании теста (см. tests.exam_type,
// список типов в app/teacher/tests/new/page.tsx) — определять его по
// содержимому документа не нужно, только подобрать алгоритм под уже
// известный тип.
//
// Сейчас есть только универсальный (generic) алгоритм — он же fallback для
// типов без своего модуля и для документов без типа ("иной документ").
// Новый тип добавляется одной строкой в PARSERS, когда появится нужда.
import { parseGeneric } from './generic'
import type { ExamParser, ParsedExamDocument, PaddlePage } from './types'

export * from './types'

const PARSERS: Record<string, ExamParser> = {
  // ОГЭ: parseOge,
  // ЕГЭ: parseEge,
  // МЦКО: parseMcko,
}

export function parseExamDocument(examType: string | null | undefined, pages: PaddlePage[]): ParsedExamDocument {
  const parser = (examType && PARSERS[examType]) || parseGeneric
  return parser(pages)
}
