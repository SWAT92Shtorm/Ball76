// ============================================================
// Инструменты (tools) для LLM — детерминированные обёртки.
// ИИ только выбирает инструмент и аргументы; выполняется код.
// ============================================================

import { getConfigCached, describeGame, doSignup, doCancel, nearestGame, upcomingDates, scheduleText } from './game.js';
import { addDays, todayMSK } from './api.js';
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

/** Разрешить дату: явную или ближайшую игру зала. */
async function resolveDate(hall, date) {
  const cfg = await getConfigCached();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { date, hallName: cfg.halls[hall].name };
  }
  const dates = await upcomingDates(hall, cfg.halls, 1);
  return { date: dates[0] || null, hallName: cfg.halls[hall].name };
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
      const { date, hallName } = await resolveDate(args.hall, args.date);
      if (!date) return { text: 'Не нашёл игру для этого зала.' };
      const g = await describeGame(args.hall, date, hallName);
      return {
        text: `${hallName}, ${g.humanDate}, ${g.startTime}${g.endTime ? '–' + g.endTime : ''}. ` +
              `Записано ${g.count}/18, свободно ${g.free}.${g.note ? ' Примечание: ' + g.note : ''}`
      };
    }

    case 'signup': {
      if (!ctxUser || !ctxUser.playerName) {
        return { text: 'Не знаю ваше ФИО — сначала привяжите профиль.' };
      }
      const { date, hallName } = await resolveDate(args.hall, args.date);
      if (!date) return { text: 'Не нашёл игру для этого зала.' };
      // НЕ выполняем сразу — просим подтверждение (см. handlers/ai.js)
      return { text: '', pendingAction: { action: 'signup', hallId: args.hall, date, hallName } };
    }

    case 'cancel': {
      if (!ctxUser || !ctxUser.playerName) {
        return { text: 'Не знаю ваше ФИО — сначала привяжите профиль.' };
      }
      const { date, hallName } = await resolveDate(args.hall, args.date);
      if (!date) return { text: 'Не нашёл игру для этого зала.' };
      return { text: '', pendingAction: { action: 'cancel', hallId: args.hall, date, hallName } };
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
