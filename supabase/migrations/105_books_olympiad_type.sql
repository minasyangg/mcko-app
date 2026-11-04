-- 105_books_olympiad_type.sql
-- Тип книги «олимпиадные задачи»: у таких задачников свой пункт «Олимпиады»
-- в «Библиотеке» (/teacher/books?type=olympiad). Первая книга — «Олимпиадная
-- физика. 11 класс» (scripts/book-import-olymp-phys-11.mjs).

alter table books drop constraint books_book_type_check;
alter table books add constraint books_book_type_check
  check (book_type in ('textbook','problem_book','workbook','didactic','olympiad'));
