// ============================================================
// Ball76 bot — доступ к PostgreSQL.
// Используется ТОЛЬКО для таблиц связки (telegram_links, telegram_chats).
// Все игровые данные — через REST API, не напрямую.
// ============================================================

import pg from 'pg';
import { config } from './config.js';
import { log } from './logger.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl });

pool.on('error', (err) => log.error('PG pool error:', err.message));

/** Сохранить/обновить связку telegram ↔ игрок. */
export async function upsertLink({ telegramId, playerId = null, playerName = null, username = null, firstName = null, lastName = null }) {
  const res = await pool.query(
    `INSERT INTO telegram_links (telegram_id, player_id, player_name, username, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (telegram_id) DO UPDATE SET
       player_id   = COALESCE(EXCLUDED.player_id, telegram_links.player_id),
       player_name = COALESCE(EXCLUDED.player_name, telegram_links.player_name),
       username    = EXCLUDED.username,
       first_name  = EXCLUDED.first_name,
       last_name   = EXCLUDED.last_name,
       updated_at  = now()
     RETURNING *`,
    [telegramId, playerId, playerName, username, firstName, lastName]
  );
  return res.rows[0];
}

/** Получить связку по telegram_id. */
export async function getLink(telegramId) {
  const res = await pool.query('SELECT * FROM telegram_links WHERE telegram_id = $1', [telegramId]);
  return res.rows[0] || null;
}

/** Найти telegram_id по имени игрока (для адресных уведомлений). */
export async function getTelegramIdsByPlayerIds(playerIds) {
  if (!playerIds || playerIds.length === 0) return [];
  const res = await pool.query(
    'SELECT telegram_id FROM telegram_links WHERE player_id = ANY($1::int[])',
    [playerIds]
  );
  return res.rows.map((r) => r.telegram_id);
}

/** Зарегистрировать/обновить чат. */
export async function upsertChat({ chatId, title = null, chatType = null, isGroup = false }) {
  const res = await pool.query(
    `INSERT INTO telegram_chats (chat_id, title, chat_type, is_group)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (chat_id) DO UPDATE SET
       title      = EXCLUDED.title,
       chat_type  = EXCLUDED.chat_type,
       is_group   = EXCLUDED.is_group,
       updated_at = now()
     RETURNING *`,
    [chatId, title, chatType, isGroup]
  );
  return res.rows[0];
}

/** Все чаты, подписанные на рассылки. */
export async function getNotifyChats() {
  const res = await pool.query('SELECT * FROM telegram_chats WHERE notify = true');
  return res.rows;
}

/** Все группы, где состоит бот (для рассылок по названию группы). */
export async function getAllGroups() {
  const res = await pool.query(
    `SELECT chat_id, title, chat_type, is_group, notify
       FROM telegram_chats
      WHERE is_group = true
      ORDER BY title NULLS LAST, chat_id`
  );
  return res.rows;
}

/** Сохранить распознанный опрос (message_id/poll_id → зал и даты). */
export async function savePoll({ messageId, pollId = null, chatId, hallId, hallName, dates }) {
  await pool.query(
    `INSERT INTO poll_games (message_id, poll_id, chat_id, hall_id, hall_name, dates)
       VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (message_id) DO UPDATE SET
       poll_id    = COALESCE(EXCLUDED.poll_id, poll_games.poll_id),
       hall_id    = EXCLUDED.hall_id,
       hall_name  = EXCLUDED.hall_name,
       dates      = EXCLUDED.dates,
       created_at = now()`,
    [messageId, pollId, chatId, hallId, hallName, dates]
  );
}

/** Получить распознанный опрос по message_id. */
export async function getPoll(messageId) {
  const res = await pool.query(
    'SELECT * FROM poll_games WHERE message_id = $1',
    [messageId]
  );
  return res.rows[0] || null;
}

/** Получить распознанный опрос по poll_id (для ответа на опрос). */
export async function getPollByPollId(pollId) {
  if (!pollId) return null;
  const res = await pool.query(
    'SELECT * FROM poll_games WHERE poll_id = $1',
    [pollId]
  );
  return res.rows[0] || null;
}

/** Проверить, отправлялось ли уведомление с данным ключом. */
export async function isNotifySent(key) {
  const res = await pool.query('SELECT 1 FROM notify_sent WHERE key = $1', [key]);
  return res.rowCount > 0;
}

/** Отметить уведомление как отправленное (идемпотентно). */
export async function markNotifySent(key) {
  await pool.query(
    `INSERT INTO notify_sent (key) VALUES ($1)
     ON CONFLICT (key) DO NOTHING`,
    [key]
  );
}
