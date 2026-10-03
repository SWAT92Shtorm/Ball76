-- ============================================================
-- Ball76 — миграция 005: подтверждение игры администратором.
--
-- Добавляет в таблицу games поля подтверждения конкретной игры
-- (зал + дата). Пока игра не подтверждена — confirmed = false.
-- При подтверждении фиксируется снимок суммы на одного человека
-- (confirmed_price) и число записавшихся на момент подтверждения
-- (confirmed_players), чтобы история показывала итог, не зависящий
-- от последующих изменений цены зала.
--
-- Применение (на сервере):
--   docker exec -i ball76-db psql -U Ball76 -d Ball76 < migrations/005_game_confirmation.sql
--
-- Миграция идемпотентна (IF NOT EXISTS) — повторный запуск безопасен.
-- ============================================================

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS confirmed        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_at     timestamp without time zone,
  ADD COLUMN IF NOT EXISTS confirmed_price  integer,
  ADD COLUMN IF NOT EXISTS confirmed_players integer;

COMMENT ON COLUMN public.games.confirmed         IS 'Игра подтверждена администратором (состоится)';
COMMENT ON COLUMN public.games.confirmed_at      IS 'Когда игра была подтверждена (UTC)';
COMMENT ON COLUMN public.games.confirmed_price   IS 'Сумма к оплате на одного человека, ₽ (снимок на момент подтверждения)';
COMMENT ON COLUMN public.games.confirmed_players IS 'Число записавшихся на момент подтверждения';
