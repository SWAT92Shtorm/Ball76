-- ============================================================
-- Ball76 — миграция 010: хранение опросов в БД.
--
-- Раньше карта «message_id → { hallId, hallName, dates }» жила
-- только в памяти бота и сбрасывалась при перезапуске. Из-за этого
-- реакции на опрос, созданный до перезапуска, не обрабатывались
-- (записи по опросу «не срабатывали»).
--
-- Таблица poll_games хранит распознанные опросы, чтобы они
-- переживали перезапуск бота.
--
-- Применение (на сервере):
--   docker exec -i ball76-db psql -U Ball76 -d Ball76 < migrations/010_poll_games.sql
--
-- Миграция идемпотентна (IF NOT EXISTS) — повторный запуск безопасен.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.poll_games (
  message_id  bigint      NOT NULL PRIMARY KEY,
  chat_id     bigint      NOT NULL,
  hall_id     text        NOT NULL,
  hall_name   text        NOT NULL,
  dates       text[]      NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.poll_games IS 'Распознанные опросы: message_id → зал и даты игры для записи по реакции';
