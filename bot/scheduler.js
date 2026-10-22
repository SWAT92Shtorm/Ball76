// ============================================================
// Планировщик уведомлений (node-cron).
// Напоминания и добор — БЕЗ ИИ, напрямую через Telegram API.
// ============================================================

import cron from 'node-cron';
import { config } from './config.js';
import { api, todayMSK, humanDate, addDays } from './api.js';
import { getConfigCached, describeGame, upcomingDates } from './game.js';
import { getNotifyChats, getAllGroups, getTelegramIdsByPlayerIds, savePoll, isNotifySent, markNotifySent } from './db.js';
import { log } from './logger.js';

// Отметки отправленного хранятся в БД (таблица notify_sent), чтобы переживать
// перезапуски бота и не дублировать уведомления (стоимость, напоминания и т.п.).
async function alreadySent(key) {
  return isNotifySent(key);
}
async function markSent(key) {
  await markNotifySent(key);
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
 * Собрать ID чатов, подходящих под зал (по названию группы и HALL_KEYWORDS),
 * плюс явно заданные NOTIFY_GROUP_IDS.
 * Если HALL_KEYWORDS не задан — поведение прежнее: все подписанные чаты.
 */
async function hallTargetIds(hallId, hallName) {
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

  return targetIds;
}

/**
 * Отправить текст в группы, подходящие под зал (по названию группы и
 * HALL_KEYWORDS), плюс явно заданные NOTIFY_GROUP_IDS.
 * Если HALL_KEYWORDS не задан — поведение прежнее: все подписанные чаты.
 */
async function broadcastForHall(bot, text, hallId, hallName, parseMode) {
  const targetIds = await hallTargetIds(hallId, hallName);

  let n = 0;
  for (const chatId of targetIds) {
    try {
      await bot.api.sendMessage(chatId, text, parseMode ? { parse_mode: parseMode } : undefined);
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
      if (await alreadySent(key)) continue;

      await broadcastForHall(bot, `⏰ Напоминание!\n${gameSummary(g)}`, hallId, hall.name);
      await markSent(key);
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
      if (await alreadySent(key)) continue;

      // Недобор шлём только при 7–9 участниках: меньше 7 — игра фактически
      // ещё не собирается, 10+ — уже достаточно для полноценной игры.
      if (g.count < 7 || g.count > 9) continue;

      const free = 18 - g.count;
      await broadcastForHall(bot, `📣 Недобор!\n${gameSummary(g)}\nСвободно мест: ${free}`, hallId, hall.name);
      await markSent(key);
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
    // Сегодняшнюю игру тоже проверяем на отправку стоимости, даже если она
    // уже началась/прошла (upcomingDates её исключает после начала). Это нужно,
    // чтобы бот отправлял стоимость, когда игру подтвердили до 23:59.
    const today = todayMSK();
    if (!dates.includes(today)) dates.push(today);
    for (const date of dates) {
      const time = await api.getGameTime(hallId, date).catch(() => null);
      if (!time || !time.confirmed) continue;
      if (time.confirmedPrice == null) continue;

      const key = `price:${hallId}:${date}`;
      if (await alreadySent(key)) continue;

      const g = await describeGame(hallId, date, hall.name);
      const price = Number(time.confirmedPrice);
      const players = time.confirmedPlayers != null ? Number(time.confirmedPlayers) : g.count;

      const bank = hall.bank || 'Сбербанк';
      // Номер телефона делаем кликабельной ссылкой (tel:). Остальной текст
      // экранируем, т.к. отправляем с parse_mode: 'HTML'.
      const esc = (s) => String(s).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
      const phoneDigits = hall.phone ? hall.phone.replace(/[^\d+]/g, '') : '';
      const phoneLink = hall.phone
        ? `<a href="tel:${esc(phoneDigits)}">${esc(hall.phone)}</a>`
        : '';
      const text =
        `✅ Игра состоялась!\n\n` +
        `🏀 ${esc(g.hallName)} — ${esc(g.humanDate)}, ${esc(g.startTime)}\n` +
        `Стоимость: ${esc(price)} ₽ с человека\n` +
        `Записано: ${esc(players)}/18\n` +
        (hall.responsible ? `👤 Получатель: ${esc(hall.responsible)}\n` : '') +
        (phoneLink ? `💳 Оплата переводом на ${esc(bank)}: ${phoneLink}` : '');

      await broadcastForHall(bot, text, hallId, hall.name, 'HTML');
      await markSent(key);
      log.info(`Стоимость подтверждённой игры ${hall.name} ${date} отправлена: ${price} ₽`);
    }
  }
}

/**
 * Автоматическое формирование опроса для зала.
 * Если у зала включён флаг pollEnabled — бот сам создаёт открытый опрос
 * с вариантами «+» и «+ за товарища» в подходящих группах.
 * Название опроса: название зала + дата и время игры (с учётом изменений
 * времени и причины). Опрос сохраняется в БД, чтобы ответы на него
 * обрабатывались как обычно.
 */
async function checkPollCreation(bot) {
  const cfg = await getConfigCached();
  // Опрос создаём за 2 дня до игры.
  const targetDate = addDays(todayMSK(), 2);

  for (const [hallId, hall] of Object.entries(cfg.halls)) {
    // Формирование опроса для зала отключено — пропускаем.
    if (hall.pollEnabled === false) continue;

    const dates = await upcomingDates(hallId, cfg.halls, 3);
    for (const date of dates) {
      // Создаём опрос только за 2 дня до игры.
      if (date !== targetDate) continue;

      const g = await describeGame(hallId, date, hall.name);
      if (!g.startTime || g.startTime === '—') continue;

      const key = `poll:${hallId}:${date}`;
      if (await alreadySent(key)) continue;

      // Название опроса: зал + дата и время игры (с учётом изменений времени и причины).
      let question = `🏀 ${g.hallName} — ${g.humanDate}, ${g.startTime}`;
      if (g.isOverride) {
        question += g.note ? `\n⚠️ Время изменено: ${g.note}` : '\n⚠️ Время изменено';
      }

      const targetIds = await hallTargetIds(hallId, hall.name);
      let n = 0;
      for (const chatId of targetIds) {
        try {
          const sent = await bot.api.sendPoll(chatId, question, ['➕ за себя', '➕ за товарища'], {
            is_anonymous: false,
            allows_multiple_answers: true
          });
          // Сохраняем опрос, чтобы ответы на него обрабатывались как обычно.
          await savePoll({
            messageId: sent.message_id,
            pollId: sent.poll && sent.poll.id,
            chatId,
            hallId,
            hallName: hall.name,
            dates: [date]
          });
          n++;
        } catch (e) {
          log.warn(`Опрос в ${chatId} не создан: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 120)); // ~8 msg/сек — ниже лимитов
      }

      if (n > 0) {
        await markSent(key);
        log.info(`Опрос для «${hall.name}» ${date} создан в ${n} чат(ах): «${question}»`);
      }
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

  // Стоимость подтверждённых игр — каждую минуту (мгновенная реакция на подтверждение)
  cron.schedule('* * * * *', () => checkConfirmedPrice(bot).catch((e) => log.error('confirmed-price:', e.message)), {
    timezone: config.tz
  });

  // Автоматическое формирование опросов — каждые 5 минут
  cron.schedule('*/5 * * * *', () => checkPollCreation(bot).catch((e) => log.error('poll-creation:', e.message)), {
    timezone: config.tz
  });

  log.info('Планировщик запущен (напоминания — ежечасно, добор — 12:00 и 18:00, стоимость — каждые 5 мин, опросы — каждые 5 мин)');
}

export { broadcast, gameSummary };
