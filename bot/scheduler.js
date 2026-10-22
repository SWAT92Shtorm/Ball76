// ============================================================
// Планировщик уведомлений (node-cron).
// Напоминания и добор — БЕЗ ИИ, напрямую через Telegram API.
// ============================================================

import cron from 'node-cron';
import { config } from './config.js';
import { api, todayMSK, humanDate } from './api.js';
import { getConfigCached, describeGame, upcomingDates } from './game.js';
import { getNotifyChats, getAllGroups, getTelegramIdsByPlayerIds } from './db.js';
import { log } from './logger.js';

// Отметки отправленного, чтобы не дублировать (в пределах суток).
const sent = new Map(); // key → timestamp

function alreadySent(key) {
  return sent.has(key);
}
function markSent(key) {
  sent.set(key, Date.now());
  // чистим старые записи (> 24 ч)
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  for (const [k, t] of sent) if (t < dayAgo) sent.delete(k);
}

/** Отправить текст во все чаты, подписанные на рассылки, с антифлуд-паузой. */
async function broadcast(bot, text) {
  const chats = await getNotifyChats();
  const targetIds = new Set(chats.map((c) => String(c.chat_id)));
  for (const id of config.notifyGroupIds) targetIds.add(String(id));

  let n = 0;
  for (const chatId of targetIds) {
    try {
      await bot.api.sendMessage(chatId, text);
      n++;
    } catch (e) {
      log.warn(`Рассылка в ${chatId} не удалась: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 120)); // ~8 msg/сек — ниже лимитов
  }
  log.info(`Рассылка отправлена в ${n} чат(ов)`);
  return n;
}

/**
 * Подходит ли группа для уведомлений о конкретном зале.
 * Группа подходит, если её название содержит название зала ИЛИ одно из
 * ключевых слов, заданных в HALL_KEYWORDS для этого зала.
 */
export function hallMatchesGroup(hallId, hallName, groupTitle) {
  if (!groupTitle) return false;
  const t = String(groupTitle).toLowerCase();
  if (hallName && t.includes(String(hallName).toLowerCase())) return true;
  const words =
    config.hallKeywords[String(hallId).toLowerCase()] ||
    config.hallKeywords[String(hallName || '').toLowerCase()] ||
    [];
  return words.some((w) => t.includes(w));
}

/**
 * Отправить текст в группы, подходящие под зал (по названию группы и
 * HALL_KEYWORDS), плюс явно заданные NOTIFY_GROUP_IDS.
 * Если HALL_KEYWORDS не задан — поведение прежнее: все подписанные чаты.
 */
async function broadcastForHall(bot, text, hallId, hallName) {
  const hasKeywords = Object.keys(config.hallKeywords).length > 0;

  // Явные группы из .env получают всегда (админ сам указал их для зала).
  const targetIds = new Set(config.notifyGroupIds.map((id) => String(id)));

  if (hasKeywords) {
    // Режим «по названию группы»: только подходящие группы.
    const groups = await getAllGroups();
    for (const g of groups) {
      if (g.notify === false) continue;
      if (hallMatchesGroup(hallId, hallName, g.title)) {
        targetIds.add(String(g.chat_id));
      }
    }
  } else {
    // Обратная совместимость: все подписанные чаты.
    const chats = await getNotifyChats();
    for (const c of chats) targetIds.add(String(c.chat_id));
  }

  let n = 0;
  for (const chatId of targetIds) {
    try {
      await bot.api.sendMessage(chatId, text);
      n++;
    } catch (e) {
      log.warn(`Рассылка в ${chatId} не удалась: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 120)); // ~8 msg/сек — ниже лимитов
  }
  log.info(`Рассылка о зале «${hallName}» отправлена в ${n} чат(ов)`);
  return n;
}

/** Сформировать сводку по игре. */
function gameSummary(g) {
  const lines = [`🏀 ${g.hallName} — ${g.humanDate}, ${g.startTime}`];
  lines.push(`Записано: ${g.count}/18`);
  if (g.isOverride) lines.push(`⚠️ Время изменено${g.note ? `: ${g.note}` : ''}`);
  return lines.join('\n');
}

/** Проверка напоминаний: игры в ближайшие reminderHoursBefore часов. */
async function checkReminders(bot) {
  const cfg = await getConfigCached();
  const now = Date.now();

  for (const [hallId, hall] of Object.entries(cfg.halls)) {
    // Уведомления для зала отключены в кабинете ответственного — пропускаем.
    if (hall.notifyEnabled === false) continue;
    const dates = await upcomingDates(hallId, cfg.halls, 3);
    for (const date of dates) {
      const g = await describeGame(hallId, date, hall.name);
      if (!g.startTime || g.startTime === '—') continue;

      // МСК-время начала → Date
      const startMs = new Date(`${date}T${g.startTime}:00+03:00`).getTime();
      const diffH = (startMs - now) / 3600000;
      if (diffH < 0 || diffH > config.reminderHoursBefore) continue;

      const key = `remind:${hallId}:${date}`;
      if (alreadySent(key)) continue;

      await broadcastForHall(bot, `⏰ Напоминание!\n${gameSummary(g)}`, hallId, hall.name);
      markSent(key);
    }
  }
}

/** Проверка добора: игра в пределах gatherHoursBefore и недобор. */
async function checkGather(bot) {
  const cfg = await getConfigCached();
  const now = Date.now();

  for (const [hallId, hall] of Object.entries(cfg.halls)) {
    // Уведомления для зала отключены в кабинете ответственного — пропускаем.
    if (hall.notifyEnabled === false) continue;
    const dates = await upcomingDates(hallId, cfg.halls, 3);
    for (const date of dates) {
      const g = await describeGame(hallId, date, hall.name);
      if (g.isFull || !g.startTime || g.startTime === '—') continue;

      const startMs = new Date(`${date}T${g.startTime}:00+03:00`).getTime();
      const diffH = (startMs - now) / 3600000;
      if (diffH < 0 || diffH > config.gatherHoursBefore) continue;

      const key = `gather:${hallId}:${date}`;
      if (alreadySent(key)) continue;

      // Недобор шлём только при 7–9 участниках: меньше 7 — игра фактически
      // ещё не собирается, 10+ — уже достаточно для полноценной игры.
      if (g.count < 7 || g.count > 9) continue;

      const free = 18 - g.count;
      await broadcastForHall(bot, `📣 Недобор!\n${gameSummary(g)}\nСвободно мест: ${free}`, hallId, hall.name);
      markSent(key);
    }
  }
}

/**
 * Отправка стоимости в ТГ при подтверждении игры.
 * Бот периодически опрашивает сервер о ближайших играх залов, у которых
 * включён флаг notifyPriceEnabled. Если игра подтверждена и стоимость ещё
 * не отправлялась — шлём сообщение в подходящие группы.
 */
async function checkConfirmedPrice(bot) {
  const cfg = await getConfigCached();
  for (const [hallId, hall] of Object.entries(cfg.halls)) {
    // Отправка стоимости для зала отключена — пропускаем.
    if (hall.notifyPriceEnabled === false) continue;

    const dates = await upcomingDates(hallId, cfg.halls, 3);
    for (const date of dates) {
      const time = await api.getGameTime(hallId, date).catch(() => null);
      if (!time || !time.confirmed) continue;
      if (time.confirmedPrice == null) continue;

      const key = `price:${hallId}:${date}`;
      if (alreadySent(key)) continue;

      const g = await describeGame(hallId, date, hall.name);
      const price = Number(time.confirmedPrice);
      const players = time.confirmedPlayers != null ? Number(time.confirmedPlayers) : g.count;

      const text =
        `✅ Игра подтверждена!\n\n` +
        `🏀 ${g.hallName} — ${g.humanDate}, ${g.startTime}\n` +
        `Стоимость: ${price} ₽ с человека\n` +
        `Записано: ${players}/18`;

      await broadcastForHall(bot, text, hallId, hall.name);
      markSent(key);
      log.info(`Стоимость подтверждённой игры ${hall.name} ${date} отправлена: ${price} ₽`);
    }
  }
}

/** Запустить планировщик. */
export function startScheduler(bot) {
  // Напоминания — каждый час в :00 (МСК)
  cron.schedule('0 * * * *', () => checkReminders(bot).catch((e) => log.error('reminders:', e.message)), {
    timezone: config.tz
  });

  // Добор — каждый день в 12:00 и 18:00 (МСК)
  cron.schedule('0 12,18 * * *', () => checkGather(bot).catch((e) => log.error('gather:', e.message)), {
    timezone: config.tz
  });

  // Стоимость подтверждённых игр — каждые 5 минут (быстрая реакция на подтверждение)
  cron.schedule('*/5 * * * *', () => checkConfirmedPrice(bot).catch((e) => log.error('confirmed-price:', e.message)), {
    timezone: config.tz
  });

  log.info('Планировщик запущен (напоминания — ежечасно, добор — 12:00 и 18:00, стоимость — каждые 5 мин)');
}

export { broadcast, gameSummary };
