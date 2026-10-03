-- ============================================================
-- Ball76 — миграция 003: залы и их график.
--
-- Залы раньше были жёстко зашиты в APP_CONFIG (hall1/hall2).
-- Теперь они живут в БД, а админ может создавать залы и задавать
-- их график прямо из веб-админ-панели.
--
-- Существующие данные НЕ трогаются: games.hall_id остаётся text,
-- таблица halls лишь описывает залы (имя, цены, расписание).
--
-- Применение (на сервере):
--   docker exec -i ball76-db psql -U Ball76 -d Ball76 < migrations/003_halls.sql
--
-- Миграция идемпотентна (IF NOT EXISTS) — повторный запуск безопасен.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.halls (
  id           serial PRIMARY KEY,
  sys_name     text UNIQUE NOT NULL,          -- hall1, hall2, hall3...
  name         text NOT NULL,                 -- ЛОКОМОТИВ, АТЛАНТ...
  phone        text,
  responsible  text,
  prices       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"full":6000,"short":4500}
  per_person   integer,                       -- NULL = делить аренду на всех
  schedule     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{"day":"Tuesday","from":21,"to":23}]
  active       boolean NOT NULL DEFAULT true, -- false = зал скрыт (вместо удаления)
  created_at   timestamp without time zone NOT NULL DEFAULT now(),
  updated_at   timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_halls_active ON public.halls (active);

COMMENT ON TABLE  public.halls IS 'Залы клуба и их график (заменяет APP_CONFIG.halls)';
COMMENT ON COLUMN public.halls.sys_name    IS 'Системное имя зала (slug), совпадает с games.hall_id';
COMMENT ON COLUMN public.halls.name        IS 'Отображаемое название зала';
COMMENT ON COLUMN public.halls.prices      IS 'Цены аренды: {"full":...,"short":...} в рублях';
COMMENT ON COLUMN public.halls.per_person  IS 'Фиксированная сумма с человека; NULL = делить аренду на всех';
COMMENT ON COLUMN public.halls.schedule    IS 'График: [{"day":"Tuesday","from":21,"to":23}] (час МСК, день — англ. название)';
COMMENT ON COLUMN public.halls.active      IS 'false — зал деактивирован (скрыт, но игры сохраняются)';

-- Перенос текущих залов из APP_CONFIG (идемпотентно: ON CONFLICT DO NOTHING).
INSERT INTO public.halls (sys_name, name, phone, responsible, prices, per_person, schedule)
VALUES
  (
    'hall1', 'ЛОКОМОТИВ', '+7 (961) 154-44-11', 'Андрей Дубровин',
    '{"full":6000,"short":4500}'::jsonb, NULL,
    '[{"day":"Tuesday","from":21,"to":23},{"day":"Thursday","from":21,"to":23}]'::jsonb
  ),
  (
    'hall2', 'АТЛАНТ', '+7 (910) 979-22-99', 'Ярослав Волков',
    '{"full":6000,"short":6000}'::jsonb, 300,
    '[{"day":"Friday","from":21,"to":23}]'::jsonb
  )
ON CONFLICT (sys_name) DO NOTHING;
