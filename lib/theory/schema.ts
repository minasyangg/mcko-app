import { z } from 'zod'
import { normalizeTags, THEORY_MAX_CHARS } from './types'

// Поля блока теории в теле запросов POST/PATCH — одна схема для создания из
// библиотеки и со страницы ДЗ. Пустые строки каталожных полей → null.
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional()
    .transform((v) => (v === undefined ? undefined : v || null))

export const theoryFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Укажите заголовок').max(200),
  content_md: z.string()
    .max(THEORY_MAX_CHARS, `Теория длиннее ${THEORY_MAX_CHARS} символов — разбейте на несколько блоков`)
    .refine((s) => s.trim().length > 0, 'Текст теории пуст'),
  source_ref: optionalText(300),
  subject: optionalText(100),
  grade: optionalText(20),
  summary: optionalText(500),
  tags: z.union([z.array(z.string()), z.string()]).optional()
    .transform((v) => (v === undefined ? undefined : normalizeTags(v))),
})

export const theoryCreateSchema = theoryFieldsSchema
export const theoryPatchSchema = theoryFieldsSchema.partial()

export type TheoryCreateInput = z.infer<typeof theoryCreateSchema>
