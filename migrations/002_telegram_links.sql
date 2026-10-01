-- ============================================================
-- Ball76 — миграция 002: связка Telegram ↔ игрок + чаты-подписчики.
--
-- Добавляет ДВЕ НОВЫЕ таблицы, существующие данные не трогает:
--   telegram_links — связь telegram_id ↔ player_id (для записи/отмены и
--                    адресных уведомлений конкретному игроку);
--   telegram_chats — группы/чаты, подписанные на рассылку.
--
-- Применение (на сервере):
--   docker exec -i ball76-db psql -U Ball76 -d Ball76 < migrations/002_telegram_links.sql
--
-- Миграция идемпотентна (IF NOT EXISTS) — повторный запуск безопасен.
-- ============================================================

-- Связка Telegram-аккаунта с игроком (players.name).
-- player_id может быть NULL: пользователь нажал /start, но ещё не указан
-- в базе как игрок (например, новый участник — привяжется позже по ФИО).
CREATE TABLE IF NOT EXISTS public.telegram_links (
  telegram_id  bigint PRIMARY KEY,
  player_id    integer REFERENCES public.players(id) ON DELETE CASCADE,
  player_name  text,
  username     text,
  first_name   text,
  last_name    text,
  linked_at    timestamp without time zone NOT NULL DEFAULT now(),
  updated_at   timestamp without time zone NOT NULL DEFAULT now()
);

-- Если таблица уже создана без player_name — добавим столбец (идемпотентно).
ALTER TABLE public.telegram_links
  ADD COLUMN IF NOT EXISTS player_name text;

-- Быстрый поиск обратной связи «player_id → его telegram_id».
CREATE INDEX IF NOT EXISTS idx_telegram_links_player_id
  ON public.telegram_links (player_id);

COMMENT ON TABLE  public.telegram_links IS 'Связка Telegram-пользователя с игроком (players.id)';
COMMENT ON COLUMN public.telegram_links.telegram_id IS 'Telegram user id (из апдейтов)';
COMMENT ON COLUMN public.telegram_links.player_id   IS 'Игрок из players.id; NULL = ещё не привязан к базе';
COMMENT ON COLUMN public.telegram_links.username    IS 'Telegram @username (может меняться)';

-- Чаты (личные и группы), подключённые к боту.
CREATE TABLE IF NOT EXISTS public.telegram_chats (
  chat_id   bigint PRIMARY KEY,
  title     text,
  chat_type text,
  is_group  boolean NOT NULL DEFAULT false,
  notify    boolean NOT NULL DEFAULT true,
  added_at  timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.telegram_chats IS 'Чаты/группы, подключённые к боту (для рассылок)';
COMMENT ON COLUMN public.telegram_chats.notify   IS 'Подписан ли чат на рассылки (напоминания, добор)';
COMMENT ON COLUMN public.telegram_chats.is_group IS 'true — группа/супергруппа, false — личка';
