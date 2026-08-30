-- PDF-импорт теста теперь распознаётся асинхронно через PaddleOCR (job API):
-- триггер только отправляет job(ы) и возвращается, а GET /api/parsing/jobs/[id]
-- на каждом опросе фронтенда проверяет статус в PaddleOCR и сам довершает
-- разбор, когда OCR готов. ocr_state хранит id job'ов PaddleOCR по документам
-- и живой прогресс — чтобы несколько учителей могли парсить одновременно,
-- не блокируя друг друга и не выглядя "подвисшими" для пользователя.
alter table parsing_jobs add column if not exists ocr_state jsonb;

comment on column parsing_jobs.ocr_state is
  'Состояние асинхронных PaddleOCR job''ов для PDF-импорта: {examType, docs: [{docId, filename, ocrJobId, state, jsonUrl}]}. Null для JSON/MD-импорта (OCR не нужен).';
