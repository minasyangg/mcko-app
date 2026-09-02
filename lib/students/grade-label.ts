// Как показывать класс ученика в списках и отчётах.
//
// После ежегодного перевода (миграция 047) выпускник 11 класса не удаляется и
// не меняет роль — у него выставляется study_stage='student' и очищается
// grade. Поэтому «класс» на экране — это либо номер класса школьника, либо
// пометка «Студент», и собирать эту логику в каждом компоненте не нужно.

export type StudyStage = 'school' | 'student' | null | undefined

export function gradeLabel(grade: string | null | undefined, studyStage?: StudyStage): string {
  if (studyStage === 'student') return 'Студент'
  return grade?.trim() || '—'
}

// Для мест, где рядом уже написано слово «класс» («8 класс»): у студента
// такой подписи быть не должно.
export function gradeWithSuffix(grade: string | null | undefined, studyStage?: StudyStage): string {
  if (studyStage === 'student') return 'Студент'
  const g = grade?.trim()
  return g ? `${g} класс` : '—'
}
