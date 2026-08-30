// Общие типы для модулей парсинга готового PaddleOCR-JSON по типу экзамена.
// Оба пайплайна PaddleOCR (PP-StructureV3 и VL) отдают одинаковую форму —
// массив уже размеченных по layout-блокам страниц, см.
// docs/book-ocr-import-pipeline.md (тот же формат использует book-import).

export interface PaddleBlock {
  block_label: string
  block_content: string
  block_bbox: [number, number, number, number]
  block_id: number
  block_order?: number
}

export interface PaddlePage {
  prunedResult: { parsing_res_list: PaddleBlock[] }
  inputImage: Record<string, string>
}

export interface JsonImageRef {
  pageImgUrl: string
  bbox: [number, number, number, number]
  blockId: number
  sortOrder: number
}

export interface JsonTaskRaw {
  number: number
  conditionParts: string[]
  solutionParts: string[]
  answer: string | null
  conditionImageRefs: JsonImageRef[]  // показываются в условии
  solutionImageRefs: JsonImageRef[]   // только в решении (по запросу ученика)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ParsedTask = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ParsedAnswer = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ParsedSolution = any

export interface ParsedExamDocument {
  meta: Record<string, string>
  tasks: ParsedTask[]
  answers: ParsedAnswer[]
  solutions: ParsedSolution[]
  warnings: unknown[]
  rawTasks: JsonTaskRaw[]
}

// Один модуль парсинга = одна функция "готовые страницы OCR → задания".
// Регистрируется в lib/parsing/exam-parsers/index.ts под ключом exam_type.
export type ExamParser = (pages: PaddlePage[]) => ParsedExamDocument
