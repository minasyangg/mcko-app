// ИИ-решатель заданий без ответа (DeepSeek). Решает школьное задание по
// тексту условия и возвращает эталонный ответ + метод авто-проверки.
// Fail-soft: любая проблема (нет ключа, сеть, невалидный JSON, низкая
// уверенность) → null, задание остаётся без ответа, как раньше.

import { requiresExplanation, cleanParsedAnswer, detectGradingMethod, buildFormatHint } from '@/lib/grading/answer-heuristics'

export interface SolvedAnswer {
  answerText: string
  gradingMethod: string
  answerFormatHint: string | null
  confidence: 'high' | 'medium'
  solutionBrief: string | null
}

const SYSTEM_PROMPT = `Ты опытный школьный учитель. Тебе дают задание из учебника или экзаменационного сборника (5–11 класс, ОГЭ/ЕГЭ/ВПР). Реши его и дай ТОЛЬКО итоговый ответ.

Правила ответа:
- Формулы в условии записаны в LaTeX ($...$). Свой ответ давай БЕЗ LaTeX, простым текстом: дроби — десятичной дробью (4.5) или в виде a/b, степени — символами (x²) или словами.
- Если в задании подпункты а) б) в) — ответ в формате "а) ...; б) ...; в) ...".
- Если задание с вариантами ответов — укажи номер(а)/букву(ы) правильного варианта.
- Не пиши ход решения в поле answer — только итог.
- Если не уверен в решении или задание требует рисунка/построения/измерений — can_solve: false.

Отвечай СТРОГО валидным JSON:
{"can_solve": true|false, "answer": "...", "confidence": "high|medium|low", "solution_brief": "1-2 предложения хода решения"}`

export async function solveProblemWithAI(input: {
  promptMd: string
  options?: unknown[] | null
  taskType?: string | null
  subject?: string | null
}): Promise<SolvedAnswer | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return null

  const prompt = input.promptMd?.trim()
  if (!prompt) return null

  const parts: string[] = []
  if (input.subject) parts.push(`Предмет: ${input.subject}`)
  parts.push(`Задание:\n${prompt.slice(0, 6000)}`)
  if (Array.isArray(input.options) && input.options.length > 0) {
    parts.push(`Варианты ответа:\n${JSON.stringify(input.options).slice(0, 1500)}`)
  }

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: parts.join('\n\n') },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.0,
        max_tokens: 2000,
      }),
    })
    if (!res.ok) {
      console.error('[ai-solve] DeepSeek error', res.status, (await res.text().catch(() => '')).slice(0, 200))
      return null
    }
    const json = await res.json()
    const content = json.choices?.[0]?.message?.content
    if (!content) return null

    const parsed = JSON.parse(content) as {
      can_solve?: boolean
      answer?: string
      confidence?: string
      solution_brief?: string
    }

    if (!parsed.can_solve || parsed.confidence === 'low') return null
    const raw = (parsed.answer ?? '').trim()
    if (!raw || raw.length > 800) return null

    const answerText = cleanParsedAnswer(raw)
    if (!answerText) return null

    const gradingMethod = requiresExplanation(input.promptMd) ? 'manual' : detectGradingMethod(answerText)

    return {
      answerText,
      gradingMethod,
      answerFormatHint: buildFormatHint(answerText, gradingMethod),
      confidence: parsed.confidence === 'high' ? 'high' : 'medium',
      solutionBrief: parsed.solution_brief?.trim().slice(0, 500) || null,
    }
  } catch (e) {
    console.error('[ai-solve] failed:', e instanceof Error ? e.message : e)
    return null
  }
}
