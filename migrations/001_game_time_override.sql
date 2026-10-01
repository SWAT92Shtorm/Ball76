-- ============================================================
-- Ball76 — миграция 001: изменение времени игры.
--
-- Добавляет в таблицу games необязательные поля «отклонения от расписания».
-- Если они NULL — время игры берётся из APP_CONFIG (обычное расписание).
-- Если заданы — эти значения переопределяют расписание для конкретной игры
-- (hall_id + date), и на сайте показывается предупреждение игрокам.
--
-- Применение (на сервере):
--   docker exec -i ball76-db psql -U Ball76 -d Ball76 < migrations/001_game_time_override.sql
--
-- Миграция идемпотентна (IF NOT EXISTS) — повторный запуск безопасен.
-- ============================================================

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS start_time      text,
  ADD COLUMN IF NOT EXISTS end_time        text,
  ADD COLUMN IF NOT EXISTS time_note       text,
  ADD COLUMN IF NOT EXISTS time_changed_at timestamp without time zone;

COMMENT ON COLUMN public.games.start_time IS 'Время начала игры (HH:MM), NULL = по расписанию';
COMMENT ON COLUMN public.games.end_time IS 'Время окончания игры (HH:MM), NULL = по расписанию';
COMMENT ON COLUMN public.games.time_note IS 'Причина изменения времени (показывается игрокам)';
COMMENT ON COLUMN public.games.time_changed_at IS 'Когда время было изменено (UTC)';
