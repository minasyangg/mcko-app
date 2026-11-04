// Тип книги (books.book_type, CHECK в миграциях 016 и 105) → подпись в интерфейсе
export const BOOK_TYPE_LABELS: Record<string, string> = {
  textbook: 'Учебник',
  problem_book: 'Задачник',
  workbook: 'Рабочая тетрадь',
  didactic: 'Дидактические материалы',
  olympiad: 'Олимпиадные задачи',
}

export const bookTypeLabel = (type: string) => BOOK_TYPE_LABELS[type] ?? type

// Типы, у которых в «Библиотеке» свой пункт меню: /teacher/books?type=<тип>
export const BOOK_TYPE_SECTIONS: Record<string, { title: string; description: string }> = {
  olympiad: { title: 'Олимпиады', description: 'Задачники олимпиадных задач с ответами' },
}
