// ============================================================
// Обработка опросов и реакций в группах.
// Бот видит опрос (privacy mode DISABLED), определяет зал по
// названию группы (см. hallMatchesGroup в scheduler.js) или по
// названию в заголовке, распознаёт ВСЕ даты из заголовка опроса,
// а затем записывает на игру тех, кто отреагировал на опрос.
// ============================================================

import { getConfigCached, doSignup, upcomingDates } from '../game.js';
import { getLink } from '../db.js';
import { hallMatchesGroup } from '../scheduler.js';
import { log } from '../logger.js';

// message_id (в чате) → { hallId, hallName, dates: [date, ...] }
// Храним в памяти: опрос живёт недолго, перезапуск бота сбрасывает карту.
const pollMap = new Map();
const MAX_POLLS = 200;

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
  const groupTitle = ctx.chat?.title || '';
  if (!messageId) return;

  try {
    const game = await resolvePollGame(groupTitle, question);
    if (!game) {
      log.info(`Опрос без распознанной игры: «${question}» (группа «${groupTitle}»)`);
      return;
    }

    pollMap.set(messageId, game);
    // Ограничиваем размер карты.
    if (pollMap.size > MAX_POLLS) {
      const firstKey = pollMap.keys().next().value;
      pollMap.delete(firstKey);
    }

    log.info(`Опрос «${question}» → ${game.hallName}, даты: ${game.dates.join(', ')} (msg ${messageId})`);
  } catch (e) {
    log.warn('handlePoll:', e.message);
  }
}

/**
 * Обработать реакцию на сообщение.
 * Если реакцию добавили на сохранённый опрос — записываем пользователя на ВСЕ даты.
 */
export async function handleReaction(ctx) {
  const mr = ctx.messageReaction;
  if (!mr) return;

  // Реагируем только на добавление реакции (new_reaction не пуст).
  const added = mr.new_reaction && mr.new_reaction.length > 0;
  if (!added) return;

  const game = pollMap.get(mr.message_id);
  if (!game) return;

  const userId = mr.user?.id;
  if (!userId) return;

  try {
    const link = await getLink(userId);
    if (!link || !link.player_name) {
      log.info(`Реакция от ${userId}: нет привязанного ФИО — пропускаем`);
      return;
    }

    for (const date of game.dates) {
      const res = await doSignup(game.hallId, date, link.player_name);
      log.info(`Реакция от ${userId} → ${game.hallName}, ${date}: ${res.message}`);
    }
  } catch (e) {
    log.warn('handleReaction:', e.message);
  }
}
