-- ============================================================
-- Ball76 — миграция 007: счёт игры.
--
-- Хранит счёт матча для конкретной игры (зал + дата): очки команды 1
-- и команды 2. Счёт ведёт любой участник: начинается с 0:0, кнопками
-- +2/+3 добавляются очки, −2/−3 убирают их при ошибке.
--
-- Применение (на сервере):
--   docker exec -i ball76-db psql -U Ball76 -d Ball76 < migrations/007_game_score.sql
--
-- Миграция идемпотентна (IF NOT EXISTS) — повторный запуск безопасен.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.game_score (
  id          serial PRIMARY KEY,
  hall_id     text NOT NULL,
  date        date NOT NULL,
  score1      integer NOT NULL DEFAULT 0,
  score2      integer NOT NULL DEFAULT 0,
  updated_at  timestamp without time zone NOT NULL DEFAULT now(),
  updated_by  text,
  UNIQUE (hall_id, date)
);

COMMENT ON TABLE  public.game_score IS 'Счёт игры (зал + дата): очки команды 1 и команды 2';
COMMENT ON COLUMN public.game_score.hall_id    IS 'Системное имя зала (hall1, hall2, …)';
COMMENT ON COLUMN public.game_score.date       IS 'Дата игры';
COMMENT ON COLUMN public.game_score.score1     IS 'Очки команды 1';
COMMENT ON COLUMN public.game_score.score2     IS 'Очки команды 2';
COMMENT ON COLUMN public.game_score.updated_by IS 'Кто последним менял счёт (ФИО или null)';
