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

// ============================================================
// Enum types
// ============================================================
export type Role = 'student' | 'teacher' | 'admin'

export type TaskType =
  | 'single_choice'
  | 'multiple_choice'
  | 'short_text'
  | 'numeric'
  | 'composite'
  | 'manual_review'

export type GradingMethod =
  | 'exact'
  | 'normalized'
  | 'numeric_tolerance'
  | 'set_match'
  | 'contains'
  | 'regex'
  | 'manual'

export type AttemptStatus =
  | 'not_started'
  | 'in_progress'
  | 'submitted'
  | 'under_review'
  | 'checked'
  | 'expired'

export type ParseJobStatus = 'queued' | 'processing' | 'needs_review' | 'done' | 'failed'

export type ImagePlacement = 'above_text' | 'below_text' | 'inline'

export type DocType = 'tasks' | 'answers' | 'solutions' | 'mixed'

export type ReviewStatus = 'pending' | 'approved' | 'needs_fix' | 'rejected'

export type SolutionRequestStatus = 'pending' | 'approved' | 'rejected'

export type ResultVisibility = 'instant' | 'after_submit' | 'after_teacher_review' | 'never'

// ============================================================
// Composite domain types
// ============================================================

export interface TaskOption {
  id: string
  text: string
  image_ref?: string
}

export interface AnswerPart {
  label: string
  type: 'text' | 'numeric' | 'choice'
}

export interface GradingConfig {
  case_sensitive?: boolean
  tolerance?: number
  partial_credit?: boolean
  keywords?: string[]
  pattern?: string
}

export interface PartialScoreRule {
  min_correct: number
  score: number
}

// TaskMedia enriched with a signed URL for display
export interface TaskMediaWithUrl extends TaskMedia {
  signedUrl: string
}

// Task with media attached (used in test player & review)
export interface TaskWithMedia extends TestTask {
  task_media: TaskMedia[]
}

// Task enriched for student view (no answer key)
export interface StudentTask extends TaskWithMedia {
  student_answer?: AttemptTaskAnswer | null
}

// Assignment enriched with version + test info
export interface AssignmentWithTest extends Assignment {
  test_versions: TestVersion & {
    tests: Pick<Test, 'id' | 'title' | 'subject' | 'exam_type'>
  }
}

// Attempt enriched for monitor view
export interface AttemptWithStudent extends Attempt {
  profiles: Pick<Profile, 'id' | 'full_name' | 'grade'>
  assignments: Pick<Assignment, 'id' | 'group_id'> & {
    test_versions: {
      tests: Pick<Test, 'id' | 'title'>
    }
  }
}

// ============================================================
// Parsing pipeline types
// ============================================================

export interface ParsedTest {
  meta: {
    title?: string
    subject?: string
    exam_type?: string
    grade?: string
  }
  tasks: ParsedTask[]
  answers: ParsedAnswer[]
  solutions: ParsedSolution[]
  unmatched_images: UnmatchedImage[]
  warnings: ParseWarning[]
}

export interface ParsedTask {
  number: number
  prompt_text: string
  prompt_html?: string
  task_type_guess: TaskType
  options?: Array<{ id: string; text: string; image_ref?: string }>
  answer_parts?: AnswerPart[]
  answer_format_hint?: string
  image_refs: string[]
  images_placement: ImagePlacement
  has_unmatched_images: boolean
  source_pages: number[]
  confidence: number
}

export interface ParsedAnswer {
  task_number: number
  correct_answer: string | string[] | Record<string, string>
  grading_method_guess: GradingMethod
  confidence: number
}

export interface ParsedSolution {
  task_number: number
  solution_text: string
  solution_html?: string
  image_refs: string[]
  confidence: number
}

export interface UnmatchedImage {
  image_id: string
  source_page: number
  suggested_task_number?: number
  reason: string
}

export interface ParseWarning {
  type: string
  description: string
  task_number?: number
  source_page?: number
}

// ============================================================
// API response types
// ============================================================

export interface SignedUrlResponse {
  url: string
  expiresAt: number
}

export interface GradingResult {
  is_correct: boolean
  awarded_score: number
  normalized_answer: unknown
}

export interface ParseResultSummary {
  tasks_found: number
  answers_matched: number
  solutions_matched: number
  images_extracted: number
  images_attached: number
  warnings_count: number
}
