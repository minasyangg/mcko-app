// Классифицирует уже готовый ответ (найденный человеком/ИИ-ревьюером) по тем
// же правилам, что online-генерация (lib/grading/answer-heuristics.ts) и
// парсинг PDF — чтобы book_problems.grading_method не расходился между
// путями заполнения. Используется скилом .claude/skills/book-answer-reviewer.
//
// Вход — JSON через stdin: {"promptMd": "...", "answerText": "..."}
// Выход — JSON через stdout: {"cleanedAnswer","gradingMethod","answerFormatHint"}
//
// echo '{"promptMd":"Решите уравнение...","answerText":"12"}' | node scripts/classify-answer.mjs

import { requiresExplanation, cleanParsedAnswer, detectGradingMethod, buildFormatHint } from './lib/answer-heuristics.mjs'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = JSON.parse(Buffer.concat(chunks).toString('utf-8'))

const { promptMd, answerText } = input
if (typeof answerText !== 'string' || !answerText.trim()) {
  console.error('answerText required')
  process.exit(1)
}

const cleanedAnswer = cleanParsedAnswer(answerText)
const gradingMethod = requiresExplanation(promptMd ?? '') ? 'manual' : detectGradingMethod(cleanedAnswer)
const answerFormatHint = buildFormatHint(cleanedAnswer, gradingMethod)

console.log(JSON.stringify({ cleanedAnswer, gradingMethod, answerFormatHint }))
