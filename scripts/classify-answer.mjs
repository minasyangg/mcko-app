// Классифицирует уже готовый ответ (найденный человеком/ИИ-ревьюером) по тем
// же правилам, что online-генерация (lib/grading/answer-heuristics.ts) и
// парсинг PDF — чтобы book_problems.grading_method не расходился между
// путями заполнения. Используется скилом .claude/skills/book-answer-reviewer.
//
// Вход — JSON через stdin: {"promptMd": "...", "answerText": "..."}
// Выход — JSON через stdout:
//   Простой ответ:    {"cleanedAnswer","gradingMethod","answerFormatHint","isComposite":false}
//   Составной ответ:  {"cleanedAnswer","gradingMethod":"normalized","answerFormatHint":null,
//                      "isComposite":true,"correctAnswerJson":{"parts":{...}},"answerParts":[...]}
//
// При isComposite:true записывать в БД correctAnswerJson напрямую (не оборачивать в {text:...}).
//
// echo '{"promptMd":"Решите уравнение...","answerText":"12"}' | node scripts/classify-answer.mjs

import { requiresExplanation, cleanParsedAnswer, detectGradingMethod, buildFormatHint } from './lib/answer-heuristics.mjs'
import { buildCompositeAnswerKey } from './lib/multi-part-answer.mjs'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = JSON.parse(Buffer.concat(chunks).toString('utf-8'))

const { promptMd, answerText } = input
if (typeof answerText !== 'string' || !answerText.trim()) {
  console.error('answerText required')
  process.exit(1)
}

const cleanedAnswer = cleanParsedAnswer(answerText)

if (!requiresExplanation(promptMd ?? '')) {
  const composite = buildCompositeAnswerKey(cleanedAnswer)
  if (composite.isComposite) {
    console.log(JSON.stringify({
      cleanedAnswer,
      gradingMethod: 'normalized',
      answerFormatHint: null,
      isComposite: true,
      correctAnswerJson: composite.correctAnswerJson,
      answerParts: composite.answerParts,
    }))
    process.exit(0)
  }
}

const gradingMethod = requiresExplanation(promptMd ?? '') ? 'manual' : detectGradingMethod(cleanedAnswer)
const answerFormatHint = buildFormatHint(cleanedAnswer, gradingMethod)

console.log(JSON.stringify({ cleanedAnswer, gradingMethod, answerFormatHint, isComposite: false }))
