-- ============================================================
-- Ball76 — миграция 011: настройки зала для бота.
--
-- Добавляем два флага на зал:
--   * poll_enabled   — «1. Формирование опроса»: если true, бот
--                      обрабатывает опросы/реакции для этого зала
--                      (записывает на игру). Если false — игнорирует.
--   * notify_enabled — «2. Отправка уведомлений»: если true, бот
--                      шлёт напоминания и добор для этого зала.
--                      Если false — не шлёт.
--
-- По умолчанию оба флага включены (true), чтобы поведение
-- существующих залов не изменилось.
--
-- Применение (на сервере):
--   docker exec -i ball76-db psql -U Ball76 -d Ball76 < migrations/011_hall_notify_poll.sql
--
-- Миграция идемпотентна (IF NOT EXISTS) — повторный запуск безопасен.
-- ============================================================

ALTER TABLE public.halls
  ADD COLUMN IF NOT EXISTS poll_enabled   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.halls.poll_enabled   IS 'true — бот обрабатывает опросы/реакции для зала (формирование опроса)';
COMMENT ON COLUMN public.halls.notify_enabled IS 'true — бот отправляет уведомления (напоминания/добор) для зала';
