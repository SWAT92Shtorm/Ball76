// ============================================================
// Ball76 bot — игровая логика (общая для команд и ИИ).
// Тонкая прослойка: превращает «зал/дата» в вызовы API,
// проверяет лимит и дубли до записи.
// ============================================================

import { api, todayMSK, humanDate, addDays, scheduleForDate, findNextGameDate, weekdayName } from './api.js';
import { log } from './logger.js';

const MAX_PLAYERS = 18;

let cachedConfig = null;
export async function getConfigCached() {
  if (!cachedConfig) cachedConfig = await api.getConfig();
  return cachedConfig;
}

/** Ближайшие N дат игр для зала (по расписанию + override). */
export async function upcomingDates(hallId, halls, count = 4) {
  const dates = [];
  let cursor = todayMSK();
  for (let i = 0; i < 60 && dates.length < count; i++) {
    const d = addDays(cursor, i);
    const hasSchedule = Boolean(scheduleForDate(halls[hallId], d));
    if (hasSchedule) dates.push(d);
  }
  return dates;
}

/** Осмысленное описание игры: зал, дата, время, сколько записано. */
export async function describeGame(hallId, date, hallName) {
  const [players, time] = await Promise.all([
    api.getPlayers(hallId, date).catch(() => []),
    api.getGameTime(hallId, date).catch(() => null)
  ]);
  const free = Math.max(0, MAX_PLAYERS - players.length);
  return {
    hallId,
    hallName,
    date,
    humanDate: humanDate(date),
    weekday: weekdayName(date),
    startTime: (time && time.startTime) || '—',
    endTime: (time && time.endTime) || null,
    isOverride: Boolean(time && time.isOverride),
    note: (time && time.note) || '',
    players,
    count: players.length,
    free,
    isFull: players.length >= MAX_PLAYERS
  };
}

/**
 * Записать игрока. Возвращает { ok, message, game }.
 * Использует уже привязанное к telegram_id ФИО (имя передаётся явно).
 */
export async function doSignup(hallId, date, name) {
  const cfg = await getConfigCached();
  const hallName = cfg.halls[hallId]?.name || hallId;

  // Предварительные проверки (чтобы дать понятный ответ до обращения к API)
  const before = await describeGame(hallId, date, hallName);
  if (before.players.includes(name)) {
    return { ok: false, message: `Вы уже записаны на ${before.humanDate} (${hallName}).`, game: before };
  }
  if (before.isFull) {
    return { ok: false, message: `Игра ${before.humanDate} (${hallName}) заполнена — 18/18.`, game: before };
  }

  try {
    await api.signup(hallId, date, name);
    const after = await describeGame(hallId, date, hallName);
    return {
      ok: true,
      message: `✅ Записаны: ${hallName}, ${after.humanDate}, ${after.startTime}. Мест: ${after.count}/18.`,
      game: after
    };
  } catch (e) {
    return { ok: false, message: `Не удалось записать: ${e.message}`, game: before };
  }
}

/** Отменить запись. Возвращает { ok, message, game }. */
export async function doCancel(hallId, date, name) {
  const cfg = await getConfigCached();
  const hallName = cfg.halls[hallId]?.name || hallId;

  const before = await describeGame(hallId, date, hallName);
  if (!before.players.includes(name)) {
    return { ok: false, message: `Записи на ${before.humanDate} (${hallName}) нет.`, game: before };
  }

  try {
    await api.cancel(hallId, date, name);
    const after = await describeGame(hallId, date, hallName);
    return {
      ok: true,
      message: `❌ Отменено: ${hallName}, ${after.humanDate}. Осталось: ${after.count}/18.`,
      game: after
    };
  } catch (e) {
    return { ok: false, message: `Не удалось отменить: ${e.message}`, game: before };
  }
}

/** Найти ближайшую игру зала. */
export async function nearestGame(hallId) {
  const cfg = await getConfigCached();
  const date = await findNextGameDate(hallId, cfg.halls);
  if (!date) return null;
  return describeGame(hallId, date, cfg.halls[hallId].name);
}

/** Расписание залов текстом. */
export async function scheduleText() {
  const cfg = await getConfigCached();
  const lines = ['📅 Расписание игр:'];
  for (const [id, h] of Object.entries(cfg.halls)) {
    const days = (h.schedule || [])
      .map((s) => ({ Tuesday: 'вт', Thursday: 'чт', Friday: 'пт', Monday: 'пн', Wednesday: 'ср', Saturday: 'сб', Sunday: 'вс' }[s.day]))
      .join('/');
    const from = String(h.schedule?.[0]?.from ?? '').padStart(2, '0');
    lines.push(`\n${h.name} (${id === 'hall1' ? 'зал 1' : 'зал 2'}): ${days}, ${from}:00–${String(h.schedule?.[0]?.to ?? '').padStart(2, '0')}:00`);
  }
  return lines.join('\n');
}

/**
 * Найти ФИО игрока для пользователя: из связки (player_id → players.name)
 * либо по введённому тексту. Возвращает { name } или null.
 */
export async function resolvePlayerName({ linkedName = null, typedName = null }) {
  if (typedName) return typedName.trim();
  return linkedName;
}

export { MAX_PLAYERS };
