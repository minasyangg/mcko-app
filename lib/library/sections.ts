// Разделы библиотеки задач (пункты меню «ОГЭ/ЕГЭ» и «A-Level») — разные
// системы образования, задачи не смешиваются ни в выдаче, ни в фильтре.
// Модуль общий для сервера (app/teacher/library/page.tsx) и клиента
// (LibraryClient, LibraryFilter, TeacherNav), поэтому без 'use client'.

export type LibrarySection = 'ru' | 'alevel'

/** Составной маркер «ОГЭ + ЕГЭ» — не значение exam_type в БД, в запросе к
 *  API разворачивается в exam_type=ОГЭ&exam_type=ЕГЭ. */
export const COMBINED_OGE_EGE = 'ОГЭ/ЕГЭ'
export const OGE_EGE_TYPES = ['ОГЭ', 'ЕГЭ']
export const A_LEVEL = 'A-Level'

export function sectionOfExamTypes(examTypes: string[]): LibrarySection {
  return examTypes.includes(A_LEVEL) ? 'alevel' : 'ru'
}

export function sectionDefaultExamType(section: LibrarySection): string {
  return section === 'alevel' ? A_LEVEL : COMBINED_OGE_EGE
}

export function examTypesOfSection(section: LibrarySection): string[] {
  return section === 'alevel' ? [A_LEVEL] : OGE_EGE_TYPES
}
