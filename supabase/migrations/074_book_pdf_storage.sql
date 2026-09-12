-- Хранение сжатой копии исходного PDF книги рядом с распознанным контентом.
-- Аналог паттерна test-documents, но для книг: приватный бакет, доступ через
-- signed URL (см. lib/media/signed-urls.ts — расширить по образцу).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('book-documents', 'book-documents', false, 31457280, array['application/pdf'])
on conflict (id) do nothing;

alter table books
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_size_bytes bigint,
  add column if not exists pdf_original_size_bytes bigint;

comment on column books.pdf_storage_path is 'Путь в bucket book-documents к сжатой копии исходного PDF книги (для сверки задач с ошибками OCR). NULL — PDF не сохранён.';
comment on column books.pdf_size_bytes is 'Размер сжатого PDF в байтах.';
comment on column books.pdf_original_size_bytes is 'Размер исходного PDF до сжатия в байтах — для контроля эффективности сжатия.';

-- RLS: доступ к book-documents только для service_role (заливка идёт из
-- скрипта импорта), чтение — учителям/админам через подписанный URL,
-- аналогично test-documents.
create policy "book-documents: teachers read own org via signed url"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'book-documents'
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('teacher', 'admin')
    )
  );
