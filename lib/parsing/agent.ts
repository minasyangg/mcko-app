export interface ParsedTask {
  number: number
  prompt_text: string
  task_type_guess:
    | 'single_choice'
    | 'multiple_choice'
    | 'short_text'
    | 'numeric'
    | 'composite'
    | 'manual_review'
  options?: Array<{ id: string; text: string }>
  answer_parts?: Array<{ label: string; type: string }>
  answer_format_hint?: string
  image_refs: string[]
  images_placement: 'above_text' | 'below_text' | 'inline'
  has_unmatched_images: boolean
  source_pages: number[]
  confidence: number
}

export interface ParsedAnswer {
  task_number: number
  correct_answer: string | string[] | Record<string, string>
  grading_method_guess: 'exact' | 'normalized' | 'numeric_tolerance' | 'set_match' | 'manual'
  confidence: number
}

export interface ParsedSolution {
  task_number: number
  solution_text: string
  confidence: number
}

export interface ParsedTestResult {
  meta: {
    title?: string
    subject?: string
    exam_type?: string
    grade?: string
  }
  tasks: ParsedTask[]
  answers: ParsedAnswer[]
  solutions: ParsedSolution[]
  warnings: Array<{ type: string; description: string; task_number?: number }>
}

const SYSTEM_PROMPT = `Ты — парсер экзаменационных тестов. Тебе дан текст из PDF-документов.
Верни ТОЛЬКО JSON без комментариев в формате ParsedTest.

Правила:
1. Найди все задачи по номерам (1., 2., Задание 1, Задача 3 и т.д.)
2. Определи тип каждой задачи:
   - single_choice: есть варианты А/Б/В/Г или 1)/2)/3)/4)
   - multiple_choice: "выберите несколько", "отметьте все"
   - numeric: "вычислите", "найдите значение", числовой ответ
   - short_text: короткий текстовый ответ
   - composite: несколько подпунктов а), б), в) или 1), 2), 3)
   - manual_review: развёрнутый ответ, эссе
3. Если в тексте встречается "на рисунке", "по графику", "см. схему" — has_unmatched_images=true
4. Confidence < 0.7 если задача неполная или тип неясен
5. Правильные ответы ищи в тексте после "Ответ:", "Правильный ответ:"
6. НЕ домысливай ответы — если не нашёл, оставь null

Формат ответа (строгий JSON):
{
  "meta": { "title": "...", "subject": "...", "exam_type": "...", "grade": "..." },
  "tasks": [
    {
      "number": 1,
      "prompt_text": "Текст задачи",
      "task_type_guess": "single_choice",
      "options": [{"id": "A", "text": "Вариант А"}],
      "answer_parts": null,
      "answer_format_hint": null,
      "image_refs": [],
      "images_placement": "above_text",
      "has_unmatched_images": false,
      "source_pages": [1],
      "confidence": 0.9
    }
  ],
  "answers": [
    {
      "task_number": 1,
      "correct_answer": "A",
      "grading_method_guess": "exact",
      "confidence": 0.95
    }
  ],
  "solutions": [
    {
      "task_number": 1,
      "solution_text": "Решение...",
      "confidence": 0.8
    }
  ],
  "warnings": [
    { "type": "low_confidence", "description": "...", "task_number": 3 }
  ]
}`

export async function parseTestWithAI(
  documentsText: string,
  imageMetadata: string,
  apiKey: string
): Promise<ParsedTestResult> {
  const userContent = `Текст документов:\n${documentsText}\n\nМетаданные изображений:\n${imageMetadata}`

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 8000,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error')
    throw new Error(`DeepSeek API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('DeepSeek returned empty response')
  }

  let parsed: ParsedTestResult
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`Failed to parse DeepSeek JSON response: ${content.slice(0, 200)}`)
  }

  // Basic validation and defaults
  if (!parsed.meta) parsed.meta = {}
  if (!Array.isArray(parsed.tasks)) parsed.tasks = []
  if (!Array.isArray(parsed.answers)) parsed.answers = []
  if (!Array.isArray(parsed.solutions)) parsed.solutions = []
  if (!Array.isArray(parsed.warnings)) parsed.warnings = []

  return parsed
}
