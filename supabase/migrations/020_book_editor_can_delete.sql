-- Грант book_editors теперь несёт право удаления книги целиком.
-- Наличие строки в book_editors = право редактировать книгу (текст/задания);
-- can_delete = вдобавок право удалить всю книгу. Владелец (books.created_by)
-- и admin могут и редактировать, и удалять всегда.
alter table book_editors add column if not exists can_delete boolean not null default false;
