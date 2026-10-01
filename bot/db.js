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
