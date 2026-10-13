-- ============================================================
-- Ball76 — миграция 006: сохранение состава команд.
--
-- Хранит сформированные (перемешанные/рокированные) команды для
-- конкретной игры (зал + дата) в виде JSON: массив команд, каждая —
-- массив ФИО игроков. Позволяет открыть модалку и увидеть тот же
-- состав, что был сформирован ранее, вместо нового перемешивания.
--
-- Применение (на сервере):
--   docker exec -i ball76-db psql -U Ball76 -d Ball76 < migrations/006_game_teams.sql
--
-- Миграция идемпотентна (IF NOT EXISTS) — повторный запуск безопасен.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.game_teams (
  id          serial PRIMARY KEY,
  hall_id     text NOT NULL,
  date        date NOT NULL,
  teams       jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamp without time zone NOT NULL DEFAULT now(),
  UNIQUE (hall_id, date)
);

COMMENT ON TABLE  public.game_teams IS 'Сохранённый состав команд по игре (зал + дата)';
COMMENT ON COLUMN public.game_teams.hall_id IS 'Системное имя зала (hall1, hall2, …)';
COMMENT ON COLUMN public.game_teams.date    IS 'Дата игры';
COMMENT ON COLUMN public.game_teams.teams   IS 'JSON: массив команд, каждая — массив ФИО';
