// ============================================================
// Обработка опросов и реакций в группах.
// Бот видит опрос (privacy mode DISABLED), определяет зал по
// названию группы (см. hallMatchesGroup в scheduler.js) или по
// названию в заголовке, распознаёт ВСЕ даты из заголовка опроса,
// а затем записывает на игру тех, кто отреагировал на опрос.
// ============================================================

import { getConfigCached, doSignup, doCancel, upcomingDates } from '../game.js';
import { getLink, savePoll, getPoll, getPollByPollId, upsertLink } from '../db.js';
import { hallMatchesGroup } from '../scheduler.js';
import { log } from '../logger.js';

// Дни недели для парсинга заголовка опроса.
const DAY_ALIASES = {
  пн: 1, понедельник: 1, понед: 1,
  вт: 2, вторник: 2,
  ср: 3, среда: 3,
  чт: 4, четверг: 4, четв: 4,
  пт: 5, пятница: 5, пятн: 5,
  сб: 6, суббота: 6, суб: 6,
  вс: 0, воскресенье: 0, воскр: 0
};

// Месяцы (русские названия и сокращения) → номер месяца (1-12).
const MONTH_ALIASES = {
  января: 1, янв: 1, февраля: 2, фев: 2, марта: 3, мар: 3,
  апреля: 4, апр: 4, мая: 5, май: 5, июня: 6, июн: 6,
  июля: 7, июл: 7, августа: 8, авг: 8, сентября: 9, сен: 9,
  октября: 10, окт: 10, ноября: 11, ноя: 11, декабря: 12, дек: 12
};

// Нормализация текста для поиска: нижний регистр, без лишних символов.
function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е');
}

/**
 * Найти зал по названию группы ИЛИ по названию в заголовке опроса.
 * Сначала — группа (см. hallMatchesGroup), затем — название зала в опросе.
 * Возвращает { hallId, hallName } или null.
 */
function findHall(groupTitle, question, halls) {
  // 1) По названию группы.
  if (groupTitle) {
    for (const [hallId, h] of Object.entries(halls || {})) {
      if (hallMatchesGroup(hallId, h.name, groupTitle)) {
        return { hallId, hallName: h.name };
      }
    }
  }
  // 2) По названию зала в заголовке опроса.
  const q = norm(question);
  for (const [hallId, h] of Object.entries(halls || {})) {
    const name = norm(h.name);
    if (name && q.includes(name)) {
      return { hallId, hallName: h.name };
    }
  }
  return null;
}

/**
 * Найти день недели в заголовке опроса.
 * Возвращает номер дня недели (0=вс … 6=сб) или null.
 */
function findWeekday(question) {
  const q = norm(question);
  for (const [alias, day] of Object.entries(DAY_ALIASES)) {
    if (q.includes(alias)) return day;
  }
  return null;
}

/**
 * Найти ВСЕ даты в заголовке опроса.
 * Распознаёт форматы: "22 и 29 октября", "01.10.2026", "24.09.2026", "25 окт".
 * Возвращает массив { day, month } (без года) или пустой массив.
 */
function findDates(question) {
  const q = norm(question);
  const result = [];

  // Формат "25.10" или "25.10.2026" — числа через точку.
  const dotRe = /(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/g;
  let m;
  while ((m = dotRe.exec(q)) !== null) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      result.push({ day, month });
    }
  }

  // Формат "22 и 29 октября" / "25 октября" — числа перед названием месяца.
  // Собираем все числа, за которыми (возможно через "и"/запятую) идёт месяц.
  const wordRe = /(\d{1,2})(?:\s+и\s+|\s*,\s*|\s+)?(\d{1,2})?\s+(января|янв|февраля|фев|марта|мар|апреля|апр|мая|май|июня|июн|июля|июл|августа|авг|сентября|сен|октября|окт|ноября|ноя|декабря|дек)/g;
  while ((m = wordRe.exec(q)) !== null) {
    const month = MONTH_ALIASES[m[3]];
    if (!month) continue;
    const d1 = Number(m[1]);
    if (d1 >= 1 && d1 <= 31) result.push({ day: d1, month });
    if (m[2]) {
      const d2 = Number(m[2]);
      if (d2 >= 1 && d2 <= 31) result.push({ day: d2, month });
    }
  }

  return result;
}

/**
 * Определить даты игры по заголовку опроса.
 * Приоритет: конкретные даты из заголовка → день недели → ближайшая игра зала.
 * Возвращает { hallId, hallName, dates: [date, ...] } или null.
 */
async function resolvePollGame(groupTitle, question) {
  const cfg = await getConfigCached();
  const hall = findHall(groupTitle, question, cfg.halls);
  if (!hall) return null;

  const weekday = findWeekday(question);
  const found = findDates(question);
  const dates = await upcomingDates(hall.hallId, cfg.halls, 7);
  if (dates.length === 0) return null;

  let matched = [];
  if (found.length > 0) {
    // Ищем точные совпадения дня и месяца в ближайших игровых датах.
    for (const f of found) {
      const hit = dates.find((d) => {
        const dt = new Date(d + 'T12:00:00Z');
        return dt.getUTCDate() === f.day && dt.getUTCMonth() + 1 === f.month;
      });
      if (hit && !matched.includes(hit)) matched.push(hit);
    }
  }
  if (matched.length === 0 && weekday !== null) {
    // Ищем ближайшую дату с нужным днём недели.
    const hit = dates.find((d) => new Date(d + 'T12:00:00Z').getUTCDay() === weekday);
    if (hit) matched.push(hit);
  }
  if (matched.length === 0) {
    matched = [dates[0]];
  }

  return { hallId: hall.hallId, hallName: hall.hallName, dates: matched };
}

/**
 * Обработать новый опрос в чате.
 * Сохраняем message_id → { hallId, hallName, dates } для записи по реакции.
 */
export async function handlePoll(ctx) {
  const poll = ctx.message?.poll;
  if (!poll) return;

  const question = poll.question || '';
  const messageId = ctx.message.message_id;
  const chatId = ctx.chat?.id || 0;
  const groupTitle = ctx.chat?.title || '';
  if (!messageId) return;

  try {
    const game = await resolvePollGame(groupTitle, question);
    if (!game) {
      log.info(`Опрос без распознанной игры: «${question}» (группа «${groupTitle}»)`);
      return;
    }

    // Формирование опроса для зала отключено в кабинете ответственного — игнорируем.
    const cfg = await getConfigCached();
    const hallCfg = cfg.halls && cfg.halls[game.hallId];
    if (hallCfg && hallCfg.pollEnabled === false) {
      log.info(`Опрос «${question}»: формирование опроса для зала «${game.hallName}» отключено — пропускаем`);
      return;
    }

    // Сохраняем в БД, чтобы опрос переживал перезапуск бота.
    await savePoll({
      messageId,
      pollId: poll.id,
      chatId,
      hallId: game.hallId,
      hallName: game.hallName,
      dates: game.dates
    });

    log.info(`Опрос «${question}» → ${game.hallName}, даты: ${game.dates.join(', ')} (msg ${messageId})`);
  } catch (e) {
    log.warn('handlePoll:', e.message);
  }
}

/**
 * Обработать ответ на опрос (poll_answer).
 * Если пользователь ответил на сохранённый опрос — записываем его на ВСЕ даты.
 */
export async function handlePollAnswer(ctx) {
  const pa = ctx.pollAnswer;
  if (!pa) {
    log.info('poll_answer: ctx.pollAnswer пуст');
    return;
  }

  const pollId = pa.poll_id;
  const userId = pa.user?.id;
  log.info(`poll_answer: poll_id=${pollId}, user=${userId}`);
  if (!pollId || !userId) return;

  try {
    const game = await getPollByPollId(pollId);
    if (!game) return;

    // Формирование опроса для зала отключено — не записываем на игру.
    const cfg = await getConfigCached();
    const hallCfg = cfg.halls && cfg.halls[game.hall_id];
    if (hallCfg && hallCfg.pollEnabled === false) {
      log.info(`Ответ на опрос от ${userId}: формирование опроса для зала «${game.hall_name}» отключено — пропускаем`);
      return;
    }

    const link = await getLink(userId);
    // Имя для записи: привязанное ФИО, либо имя из Telegram (first_name + last_name).
    let name = link && link.player_name;
    const usedTelegramName = !name;
    if (!name) {
      const fn = (pa.user?.first_name || '').trim();
      const ln = (pa.user?.last_name || '').trim();
      name = [fn, ln].filter(Boolean).join(' ').trim();
      if (name) {
        // Сохраняем связку telegram_id → имя из Telegram (для идентификации по логину).
        try {
          await upsertLink({
            telegramId: userId,
            playerName: name,
            username: pa.user?.username || null,
            firstName: fn || null,
            lastName: ln || null
          });
        } catch (e) {
          log.warn(`Не удалось сохранить связку для ${userId}: ${e.message}`);
        }
      }
    }

    if (!name) {
      log.info(`Ответ на опрос от ${userId}: нет имени для записи — пропускаем`);
      return;
    }

    for (const date of game.dates) {
      const res = await doSignup(game.hall_id, date, name);
      log.info(`Ответ на опрос от ${userId} → ${game.hall_name}, ${date}: ${res.message}`);
      // Если запись не удалась (например, имя короче 3 слов) — сообщаем пользователю.
      if (!res.ok) {
        try {
          await ctx.api.sendMessage(
            userId,
            `Не удалось записать вас на игру: ${res.message}\n` +
            'Отправьте мне в личку ваше полное ФИО (Фамилия Имя Отчество).'
          );
        } catch (e) {
          log.warn(`Не удалось написать ${userId}: ${e.message}`);
        }
      }
    }

    // Если записали под именем из Telegram — предложим указать полное ФИО,
    // чтобы в дальнейшем идентифицировать по правилам формы.
    if (usedTelegramName && name) {
      try {
        await ctx.api.sendMessage(
          userId,
          `Вы записаны на игру под именем «${name}».\n` +
          'Если это не ваше полное ФИО — напишите его в личку (Фамилия Имя Отчество), ' +
          'и я привяжу его к вашему профилю.'
        );
      } catch (e) {
        log.warn(`Не удалось написать ${userId} о полном ФИО: ${e.message}`);
      }
    }
  } catch (e) {
    log.warn('handlePollAnswer:', e.message);
  }
}

/**
 * Обработать реакцию на сообщение.
 * Добавление реакции — записываем пользователя на ВСЕ даты,
 * снятие реакции — отменяем запись.
 */
export async function handleReaction(ctx) {
  const mr = ctx.messageReaction;
  if (!mr) return;

  // Если на сообщении появилась реакция 👎 (дизлайк) или 🔥 (огонь) — удаляем
  // это сообщение. Работает ВСЕГДА, независимо от разрешительных признаков
  // в админке (pollEnabled / notifyEnabled / notifyPriceEnabled).
  const hasDislike = (mr.new_reaction || []).some(
    (r) => r.type === 'emoji' && (r.emoji === '👎' || r.emoji === '🔥')
  );
  if (hasDislike) {
    try {
      await ctx.api.deleteMessage(mr.chat?.id, mr.message_id);
      log.info(`Удалено сообщение ${mr.message_id} из-за реакции 👎/🔥`);
    } catch (e) {
      log.warn(`Не удалось удалить сообщение ${mr.message_id} (👎/🔥): ${e.message}`);
    }
  }

  const added = mr.new_reaction && mr.new_reaction.length > 0;
  const removed = mr.old_reaction && mr.old_reaction.length > 0;
  if (!added && !removed) return;

  const game = await getPoll(mr.message_id);
  if (!game) return;

  // Формирование опроса для зала отключено — не записываем на игру.
  const cfg = await getConfigCached();
  const hallCfg = cfg.halls && cfg.halls[game.hall_id];
  if (hallCfg && hallCfg.pollEnabled === false) {
    log.info(`Реакция от ${mr.user?.id}: формирование опроса для зала «${game.hall_name}» отключено — пропускаем`);
    return;
  }

  const userId = mr.user?.id;
  if (!userId) return;

  try {
    const link = await getLink(userId);
    // Имя для записи: привязанное ФИО, либо имя из Telegram (first_name + last_name).
    let name = link && link.player_name;
    const usedTelegramName = !name;
    if (!name) {
      const fn = (mr.user?.first_name || '').trim();
      const ln = (mr.user?.last_name || '').trim();
      name = [fn, ln].filter(Boolean).join(' ').trim();
      if (name) {
        // Сохраняем связку telegram_id → имя из Telegram (для идентификации по логину).
        try {
          await upsertLink({
            telegramId: userId,
            playerName: name,
            username: mr.user?.username || null,
            firstName: fn || null,
            lastName: ln || null
          });
        } catch (e) {
          log.warn(`Не удалось сохранить связку для ${userId}: ${e.message}`);
        }
      }
    }

    if (!name) {
      log.info(`Реакция от ${userId}: нет имени для записи — пропускаем`);
      return;
    }

    for (const date of game.dates) {
      const res = added
        ? await doSignup(game.hall_id, date, name)
        : await doCancel(game.hall_id, date, name);
      log.info(`Реакция от ${userId} → ${game.hall_name}, ${date}: ${res.message}`);
      // Если запись не удалась (например, имя короче 3 слов) — сообщаем пользователю.
      if (added && !res.ok) {
        try {
          await ctx.api.sendMessage(
            userId,
            `Не удалось записать вас на игру: ${res.message}\n` +
            'Отправьте мне в личку ваше полное ФИО (Фамилия Имя Отчество).'
          );
        } catch (e) {
          log.warn(`Не удалось написать ${userId}: ${e.message}`);
        }
      }
    }

    // Если записали под именем из Telegram — предложим указать полное ФИО,
    // чтобы в дальнейшем идентифицировать по правилам формы.
    if (usedTelegramName && name && added) {
      try {
        await ctx.api.sendMessage(
          userId,
          `Вы записаны на игру под именем «${name}».\n` +
          'Если это не ваше полное ФИО — напишите его в личку (Фамилия Имя Отчество), ' +
          'и я привяжу его к вашему профилю.'
        );
      } catch (e) {
        log.warn(`Не удалось написать ${userId} о полном ФИО: ${e.message}`);
      }
    }
  } catch (e) {
    log.warn('handleReaction:', e.message);
  }
}
