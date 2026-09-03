-- Загрузка PDF при составлении теста падала с
-- "new row violates row-level security policy".
--
-- Причина: ImportFlow грузит файл с клиента (под пользователем, RLS работает)
-- по ФИКСИРОВАННОМУ пути test-documents/{testVersionId}/tasks/original.{ext} с
-- upsert: true. Первая загрузка в тест — INSERT, она проходила. Любая
-- ПОВТОРНАЯ загрузка в тот же тест (перезалить другой файл, повторить после
-- ошибки парсинга, загрузить .json вместо .pdf) — это UPDATE, а UPDATE-политики
-- у бакета test-documents не было вообще: миграция 003 завела для него три
-- отдельные политики (insert/select/delete) и пропустила update, в отличие от
-- task-media и solution-media, где стоит "for all" и update покрыт.
--
-- Объект перезаписывается по тому же пути в рамках своей версии теста, права
-- те же, что на insert/delete — поэтому условие совпадает с остальными
-- политиками бакета. using и with_check оба нужны: without using строку не
-- видно для обновления, without with_check не пройдёт проверка нового значения.
create policy "test-documents: teacher/admin update"
  on storage.objects for update
  using (
    bucket_id = 'test-documents'
    and auth_role() in ('teacher','admin')
  )
  with check (
    bucket_id = 'test-documents'
    and auth_role() in ('teacher','admin')
  );
