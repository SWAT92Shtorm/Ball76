-- ============================================================
-- Ball76 — миграция 008: счёт по парам команд.
--
-- Если на игре сформировано 3 команды (правило: игроков ≥ 15),
-- матчей три: 1vs2, 1vs3, 2vs3. Счёт ведётся по каждой паре
-- отдельно. Колонка pair хранит пару в виде '1-2', '1-3', '2-3'.
-- Для 2 команд всегда пара '1-2'.
--
-- Применение (на сервере):
--   docker exec -i ball76-db psql -U Ball76 -d Ball76 < migrations/008_game_score_pairs.sql
--
-- Миграция идемпотентна — повторный запуск безопасен.
-- ============================================================

ALTER TABLE public.game_score
  ADD COLUMN IF NOT EXISTS pair text NOT NULL DEFAULT '1-2';

-- Уникальность переезжает с (hall_id, date) на (hall_id, date, pair):
-- старый уникальный индекс от UNIQUE (hall_id, date) нужно снять.
ALTER TABLE public.game_score
  DROP CONSTRAINT IF EXISTS game_score_hall_id_date_key;

-- Идемпотентно создаём новый уникальный индекс по трём полям.
CREATE UNIQUE INDEX IF NOT EXISTS game_score_hall_date_pair_key
  ON public.game_score (hall_id, date, pair);

COMMENT ON COLUMN public.game_score.pair IS 'Пара команд: 1-2, 1-3 или 2-3';
