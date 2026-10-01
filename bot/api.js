// ============================================================
// Ball76 bot — клиент REST API сайта.
// Вся игровая логика (лимит 18, валидация ФИО, дубли) остаётся
// на сервере. Бот только вызывает эндпоинты.
// ============================================================

import { config } from './config.js';
import { log } from './logger.js';

const BASE = config.apiBaseUrl.replace(/\/$/, '');

async function call(method, path, body = null, { retries = 2 } = {}) {
  const url = BASE + path;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      let data = null;
      try { data = await res.json(); } catch (_) { /* пустой ответ */ }

      if (!res.ok) {
        const msg = (data && data.error) || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.data = data;
        // 4xx — ошибка по существу (не повторяем), 5xx — повторяем
        if (res.status < 500) throw err;
        if (attempt > retries) throw err;
      } else {
        return data;
      }
    } catch (e) {
      if (e.status && e.status < 500) throw e; // бизнес-ошибка
      if (attempt > retries) {
        log.error(`API ${method} ${path} — ошибка:`, e.message);
        throw e;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

export const api = {
  /** Конфиг залов и расписание. */
  getConfig: () => call('GET', '/api/config'),

  /** Проверка БД. */
  getStatus: () => call('GET', '/api/status'),

  /** Игроки конкретной игры. */
  async getPlayers(hallId, date) {
    const data = await call('GET', `/api/players/${hallId}/${date}`);
    return (data && data.playersByHall && data.playersByHall[hallId]) || [];
  },

  /** Время игры (с учётом override). */
  getGameTime: (hallId, date) => call('GET', `/api/games/${hallId}/${date}/time`),

  /**
   * Даты с заданным временем (переносы и игры вне обычного графика).
   * Возвращает { date: { startTime, note, isExtra } } — нужны, чтобы
   * предлагать в боте только те дни, где игра реально запланирована.
   */
  getTimeOverrides: (hallId) => call('GET', `/api/games/${hallId}/time-overrides`),

  /** Все игроки, сгруппированные по залам { hall1: [names], hall2: [names] }. */
  async getAllPlayers() {
    const data = await call('GET', '/api/players');
    return (data && data.playersByHall) || {};
  },

  /** Записать игрока. */
  async signup(hallId, date, name) {
    const data = await call('POST', `/api/players/${hallId}`, { name, date });
    return (data && data.playersByHall && data.playersByHall[hallId]) || [];
  },

  /** Отменить запись. */
  async cancel(hallId, date, name) {
    const data = await call('DELETE', `/api/players/${hallId}/${date}/${encodeURIComponent(name)}`);
    return (data && data.playersByHall && data.playersByHall[hallId]) || [];
  },

  /** История записей (все игроки со счётчиками — используется для поиска). */
  getHistory: () => call('GET', '/api/history'),

  /**
   * Добавить игрока в справочник (без записи на игру).
   * Сервер сам валидирует ФИО и не создаёт дубликат.
   * Возвращает { created, name }.
   */
  addPlayerToDirectory: (name) => call('POST', '/api/players-directory', { name })
};

// ============================================================
// Утилиты дат (МСК)
// ============================================================

const WEEKDAYS_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Сегодняшняя дата в МСК: YYYY-MM-DD. */
export function todayMSK() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

/** Текущее время в МСК: HH:MM (для сравнения с временем начала игры). */
export function nowMSKHM() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.tz, hour: '2-digit', minute: '2-digit'
  }).format(new Date());
}

/** День недели названия зала по дате. */
export function weekdayName(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return WEEKDAYS_RU[d.getUTCDay()];
}

/** Человекочитаемая дата «Чт, 2 окт». */
export function humanDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const wd = WEEKDAYS_SHORT[d.getUTCDay()];
  const wdCap = wd[0].toUpperCase() + wd[1];
  return `${wdCap}, ${d.getUTCDate()} ${MONTHS_RU[d.getUTCMonth()]}`;
}

/** Прибавить дни к дате YYYY-MM-DD. */
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Расписание зала на дату (день недели из конфига сервера — передаём config). */
export function scheduleForDate(hallConfig, dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
  return (hallConfig.schedule || []).find((s) => s.day === dayName) || null;
}

/**
 * Найти ближайшую дату игры для зала (в пределах N дней).
 * Проверяет override из БД, поэтому функция асинхронная.
 */
export async function findNextGameDate(hallId, halls, { from = todayMSK(), maxDays = 30 } = {}) {
  // 1) Проверяем override-даты (в т.ч. «дополнительные игры»)
  let overrides = {};
  try {
    const ov = await call('GET', `/api/games/${hallId}/time-overrides`);
    overrides = (ov && ov.overrides) || {};
  } catch (e) {
    log.warn('Не удалось получить time-overrides:', e.message);
  }

  for (let i = 0; i <= maxDays; i++) {
    const date = addDays(from, i);
    // «Сегодня» считаем только если игра ещё не началась
    const hasOverride = Boolean(overrides[date]);
    const hasSchedule = Boolean(scheduleForDate(halls[hallId], date));
    if (!hasSchedule && !hasOverride) continue;

    if (i === 0) {
      // сегодня — проверяем, не прошло ли время начала
      const info = await call('GET', `/api/games/${hallId}/${date}/time`).catch(() => null);
      const start = info && info.startTime;
      if (start) {
        const now = new Intl.DateTimeFormat('en-GB', {
          timeZone: config.tz, hour: '2-digit', minute: '2-digit'
        }).format(new Date());
        if (now >= start) continue; // уже началось — ищем следующую
      }
    }
    return date;
  }
  return null;
}
