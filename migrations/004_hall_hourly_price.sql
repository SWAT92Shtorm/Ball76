-- ============================================================
-- Ball76 — миграция 004: цена за час у залов.
--
-- Раньше цены задавались сразу за 2 ч и 1.5 ч (prices.full/prices.short).
-- Теперь в админ-панели вводится ОДНА цена — за час (prices.hourly),
-- а 1,5 ч и 2 ч считаются от неё автоматически.
--
-- Миграция нужна, чтобы у уже существующих в БД залов (созданных
-- миграцией 003 без поля hourly) появилось это поле. Сервер умеет
-- выводить hourly из full и без миграции (normalizePrices), но
-- явный backfill делает данные согласованными.
--
-- Применение (на сервере):
--   docker exec -i ball76-db psql -U Ball76 -d Ball76 < migrations/004_hall_hourly_price.sql
--
-- Миграция идемпотентна — повторный запуск безопасен.
-- ============================================================

-- Проставить hourly = full / 2 там, где hourly ещё нет.
UPDATE public.halls
   SET prices = jsonb_build_object(
         'hourly', (COALESCE((prices ->> 'full')::numeric, 0) / 2)::int,
         'full',   COALESCE((prices ->> 'full')::numeric, 0)::int,
         'short',  COALESCE(
                     (prices ->> 'short')::numeric,
                     (COALESCE((prices ->> 'full')::numeric, 0) / 2) * 1.5
                   )::int
       ),
       updated_at = now()
 WHERE prices ->> 'hourly' IS NULL;

COMMENT ON COLUMN public.halls.prices IS
  'Цены аренды: {"hourly":...,"full":...,"short":...} в рублях (hourly — за час, full/short считаются автоматически)';
