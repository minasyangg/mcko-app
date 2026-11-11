import type { Tables } from './database'

// ============================================================
// Core domain aliases
// ============================================================
export type Profile = Tables<'profiles'>
export type Organization = Tables<'organizations'>
export type Group = Tables<'groups'>
export type Test = Tables<'tests'>
export type TestVersion = Tables<'test_versions'>
export type TestDocument = Tables<'test_documents'>
export type TestTask = Tables<'test_tasks'>
export type TaskMedia = Tables<'task_media'>
export type TaskAnswerKey = Tables<'task_answer_keys'>
export type TaskSolution = Tables<'task_solutions'>
export type SolutionMedia = Tables<'solution_media'>
export type Assignment = Tables<'assignments'>
export type Attempt = Tables<'attempts'>
export type AttemptTaskAnswer = Tables<'attempt_task_answers'>
export type SolutionRequest = Tables<'solution_requests'>
export type ParsingJob = Tables<'parsing_jobs'>

// Перечисления статусов, методов проверки и типов заданий здесь не дублируем:
// написанные от руки списки расходились с базой (в GradingMethod, например, не
// было 'sequence'), а источник правды — CHECK-ограничения в миграциях и
// types/database.ts.

// TaskMedia enriched with a signed URL for display
export interface TaskMediaWithUrl extends TaskMedia {
  signedUrl: string
}
