import type { Json } from '@/types/database'

// Составные ответы (multi-part-answer.ts) хранят части эталона как голый
// LaTeX без обрамления $…$ (например `[3; +\infty)`, `\left(-∞;-2\right]`) —
// buildCompositeAnswerKey чистит только \frac, остальные команды остаются
// как есть. Для ПОКАЗА через MathText это нечитаемо (та парсит только то,
// что внутри $…$ — без обёртки KaTeX не подхватывает и зритель видит сырые
// "\infty"/"\left"). Если строка уже содержит $ (эталон, который учитель сам
// набрал с долларами), считаем её оформленной и не трогаем — двойное
// оборачивание сломало бы разметку.
const HAS_LATEX_COMMAND = /\\[a-zA-Z]+/
// Экспортирована отдельно — нужна там, где строка для ПОКАЗА уже готова
// как plain string (не Json) и приходит из другого источника, чем
// formatAnswerJson (например TestDetailClient.tsx: task.correct_answer —
// уже сериализованная на сервере строка, специально formatAnswerJsonRaw
// без обёртки, потому что то же поле инициализирует форму редактирования;
// показ карточки применяет обёртку здесь, отдельно от источника формы).
export function wrapBareLatex(s: string): string {
  if (!s || s.includes('$') || !HAS_LATEX_COMMAND.test(s)) return s
  return `$${s}$`
}

// Общая рекурсивная развёртка Json → строка. `wrap` включает обёртку
// голого LaTeX в $…$ — ТОЛЬКО для показа (formatAnswerJson), никогда для
// значений, которые дальше идут в инпут редактирования и затем обратно на
// сервер (formatAnswerJsonRaw) — иначе несвязанное сохранение той же формы
// (например правка prompt_text в TestDetailClient, без касания ответа)
// молча переписывало бы correct_answer в БД добавленными $ дублями, а
// формат "а) 5; б) 12" для buildCompositeAnswerKey должен собираться из
// НЕизменённого значения, не из display-варианта.
function stringifyJson(json: Json | null | undefined, wrap: boolean): string {
  if (json === null || json === undefined) return '—'
  if (typeof json === 'string') return wrap ? wrapBareLatex(json) : json
  if (typeof json === 'number') return String(json)
  if (typeof json === 'boolean') return json ? 'Да' : 'Нет'
  if (Array.isArray(json)) return json.map(v => stringifyJson(v, wrap)).join(', ')

  const obj = json as Record<string, Json | undefined>

  if ('selected' in obj) {
    const sel = obj['selected']
    return Array.isArray(sel) ? sel.map(v => stringifyJson(v as Json, wrap)).join(', ') : stringifyJson(sel ?? null, wrap)
  }
  if ('text' in obj) return stringifyJson(obj['text'] ?? null, wrap)
  if ('value' in obj) return stringifyJson(obj['value'] ?? null, wrap)
  if ('parts' in obj && obj['parts'] !== null && typeof obj['parts'] === 'object' && !Array.isArray(obj['parts'])) {
    const parts = obj['parts'] as Record<string, Json | undefined>
    return Object.entries(parts)
      .map(([label, entry]) => {
        // эталонная форма {value, method} — берём только значение
        const v = entry !== null && typeof entry === 'object' && !Array.isArray(entry) && 'value' in entry
          ? (entry as Record<string, Json | undefined>)['value']
          : entry
        return `${label}: ${stringifyJson(v ?? null, wrap)}`
      })
      .join('; ')
  }

  return JSON.stringify(json)
}

// Человекочитаемое представление answer_json/correct_answer для ПОКАЗА
// (учителю, через MathText) и для передачи в ИИ-проверку. Голый LaTeX без
// $…$ автоматически оборачивается — см. wrapBareLatex. Не использовать для
// инициализации редактируемого текстового поля, из которого значение потом
// уходит обратно на сервер — см. formatAnswerJsonRaw ниже.
export function formatAnswerJson(json: Json | null | undefined): string {
  return stringifyJson(json, true)
}

// То же самое разворачивание Json → строка, но БЕЗ обёртки $…$ — для
// инициализации редактируемых текстовых полей (TestDetailClient,
// AttemptDrawer.startEditingAnswer, book-reader/forms, review/page), из
// которых значение может уйти обратно в БД без изменений (пользователь
// сохранил форму, не тронув конкретно это поле). formatAnswerJson там
// добавил бы $…$, которых не было в исходном correct_answer, и обычное
// сохранение несвязанного поля стало бы незаметно переписывать эталон.
export function formatAnswerJsonRaw(json: Json | null | undefined): string {
  return stringifyJson(json, false)
}
