// ============================================================
// Инструменты (tools) для LLM — детерминированные обёртки.
// ИИ только выбирает инструмент и аргументы; выполняется код.
// ============================================================

import { getConfigCached, describeGame, doSignup, doCancel, nearestGame, upcomingDates, hasGameDate, scheduleText } from './game.js';
import { addDays, todayMSK, humanDate } from './api.js';
import { log } from './logger.js';

// JSON-схемы для function calling (формат OpenAI).
export const toolDefs = [
  {
    type: 'function',
    function: {
      name: 'get_schedule',
      description: 'Расписание залов и ближайшие игры',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_game_info',
      description: 'Информация об игре: время, сколько записано, свободные места',
      parameters: {
        type: 'object',
        properties: {
          hall: { type: 'string', enum: ['hall1', 'hall2'], description: 'hall1=ЛОКОМОТИВ, hall2=АТЛАНТ' },
          date: { type: 'string', description: 'Дата YYYY-MM-DD; если не указана — ближайшая игра' }
        },
        required: ['hall']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'signup',
      description: 'Записать текущего пользователя на игру. Требует подтверждения пользователя.',
      parameters: {
        type: 'object',
        properties: {
          hall: { type: 'string', enum: ['hall1', 'hall2'] },
          date: { type: 'string', description: 'Дата YYYY-MM-DD; если не указана — ближайшая игра' }
        },
        required: ['hall']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancel',
      description: 'Отменить запись текущего пользователя. Требует подтверждения.',
      parameters: {
        type: 'object',
        properties: {
          hall: { type: 'string', enum: ['hall1', 'hall2'] },
          date: { type: 'string', description: 'Дата YYYY-MM-DD; если не указана — ближайшая игра' }
        },
        required: ['hall']
      }
    }
  }
];

/**
 * Разрешить дату: явную или ближайшую игру зала.
 * Явную дату проверяем: если игры в этот день нет — возвращаем { noGame: true },
 * чтобы бот не предлагал запись на день без игры.
 */
async function resolveDate(hall, date) {
  const cfg = await getConfigCached();
  const hallName = cfg.halls[hall].name;

  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const ok = await hasGameDate(hall, cfg.halls, date);
    if (!ok) {
      const dates = await upcomingDates(hall, cfg.halls, 5);
      return { date: null, hallName, noGame: true, requested: date, available: dates };
    }
    return { date, hallName };
  }

  const dates = await upcomingDates(hall, cfg.halls, 1);
  return { date: dates[0] || null, hallName };
}

/** Понятный ответ, когда на запрошенную дату игры нет. */
function noGameText(hallName, requested, available) {
  const list = (available || []).map((d) => humanDate(d)).join(', ');
  return `На ${humanDate(requested)} в зале ${hallName} игры нет.\n` +
    (list ? `Ближайшие игровые дни: ${list}.` : 'Ближайших игр не найдено.');
}

/**
 * Выполнить инструмент.
 * ctxUser: { telegramId, playerName } — для мутаций.
 * Возвращает { text, pendingAction? } — pendingAction сигналит о нужде подтверждения.
 */
export async function runTool(name, args, ctxUser) {
  log.info(`tool: ${name}`, JSON.stringify(args || {}));

  switch (name) {
    case 'get_schedule': {
      const cfg = await getConfigCached();
      const near = [];
      for (const hallId of Object.keys(cfg.halls)) {
        const g = await nearestGame(hallId).catch(() => null);
        if (g) near.push(`${g.hallName}: ${g.humanDate} ${g.startTime} (${g.count}/18)`);
      }
      return { text: await scheduleText() + '\nБлижайшие: ' + near.join('; ') };
    }

    case 'get_game_info': {
      const r = await resolveDate(args.hall, args.date);
      if (r.noGame) return { text: noGameText(r.hallName, r.requested, r.available) };
      if (!r.date) return { text: 'Не нашёл игру для этого зала.' };
      const g = await describeGame(args.hall, r.date, r.hallName);
      return {
        text: `${r.hallName}, ${g.humanDate}, ${g.startTime}${g.endTime ? '–' + g.endTime : ''}. ` +
              `Записано ${g.count}/18, свободно ${g.free}.${g.note ? ' Примечание: ' + g.note : ''}`
      };
    }

    case 'signup': {
      if (!ctxUser || !ctxUser.playerName) {
        return { text: 'Не знаю ваше ФИО — сначала привяжите профиль.' };
      }
      const r = await resolveDate(args.hall, args.date);
      if (r.noGame) return { text: noGameText(r.hallName, r.requested, r.available) };
      if (!r.date) return { text: 'Не нашёл игру для этого зала.' };
      // НЕ выполняем сразу — просим подтверждение (см. handlers/ai.js)
      return { text: '', pendingAction: { action: 'signup', hallId: args.hall, date: r.date, hallName: r.hallName } };
    }

    case 'cancel': {
      if (!ctxUser || !ctxUser.playerName) {
        return { text: 'Не знаю ваше ФИО — сначала привяжите профиль.' };
      }
      const r = await resolveDate(args.hall, args.date);
      if (r.noGame) return { text: noGameText(r.hallName, r.requested, r.available) };
      if (!r.date) return { text: 'Не нашёл игру для этого зала.' };
      return { text: '', pendingAction: { action: 'cancel', hallId: args.hall, date: r.date, hallName: r.hallName } };
    }

    default:
      return { text: 'Неизвестный инструмент.' };
  }
}

/** Выполнить подтверждённое действие. */
export async function execConfirmed(action, hallId, date, playerName) {
  return action === 'signup'
    ? doSignup(hallId, date, playerName)
    : doCancel(hallId, date, playerName);
}
