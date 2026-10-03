// ============================================================
// Ball76 bot — игровая логика (общая для команд и ИИ).
// Тонкая прослойка: превращает «зал/дата» в вызовы API,
// проверяет лимит и дубли до записи.
// ============================================================

import { api, todayMSK, nowMSKHM, humanDate, addDays, scheduleForDate, weekdayName } from './api.js';
import { log } from './logger.js';

const MAX_PLAYERS = 18;

// Конфиг меняется редко (расписание/залы), но и не должен «замерзать» навсегда:
// держим TTL, чтобы правки подхватывались без перезапуска бота.
const CONFIG_TTL_MS = 5 * 60 * 1000; // 5 минут
let cachedConfig = null;
let cachedConfigAt = 0;

/**
 * Конфиг залов с кэшем на CONFIG_TTL_MS.
 * force=true — принудительно обновить.
 * Если обновление не удалось, а старый конфиг есть — отдаём его (устойчивость
 * к кратковременной недоступности API).
 */
export async function getConfigCached({ force = false } = {}) {
  const fresh = cachedConfig && Date.now() - cachedConfigAt <= CONFIG_TTL_MS;
  if (!force && fresh) return cachedConfig;

  try {
    cachedConfig = await api.getConfig();
    cachedConfigAt = Date.now();
  } catch (e) {
    if (!cachedConfig) throw e; // данных нет вообще — пусть вызывающий решит
    log.warn('Не удалось обновить конфиг, использую кэш:', e.message);
  }
  return cachedConfig;
}

/**
 * Дата (в пределах MAX_DAYS вперёд), на которую игра реально запланирована.
 * Учитываем и обычное расписание, и доп. игры (override из БД).
 * «Сегодняшнюю» игру пропускаем, если время начала уже прошло.
 */
async function hasGameOn(hallId, halls, date, overrides) {
  const hasSchedule = Boolean(scheduleForDate(halls[hallId], date));
  const hasExtra = Boolean(overrides && overrides[date]);
  if (!hasSchedule && !hasExtra) return false;

  if (date === todayMSK()) {
    const time = await api.getGameTime(hallId, date).catch(() => null);
    const start = time && time.startTime;
    if (start && nowMSKHM() >= start) return false; // игра уже началась
  }
  return true;
}

/**
 * Ближайшие N дат, на которые реально есть игры (расписание + доп. игры).
 * Даты без игры не предлагаем, уже начавшуюся сегодняшнюю — пропускаем.
 */
export async function upcomingDates(hallId, halls, count = 4) {
  let overrides = {};
  try {
    const ov = await api.getTimeOverrides(hallId);
    overrides = (ov && ov.overrides) || {};
  } catch (e) {
    log.warn('Не удалось получить time-overrides:', e.message);
  }

  const dates = [];
  const cursor = todayMSK();
  for (let i = 0; i < 60 && dates.length < count; i++) {
    const d = addDays(cursor, i);
    if (await hasGameOn(hallId, halls, d, overrides)) dates.push(d);
  }
  return dates;
}

/** Есть ли игра в конкретную дату (расписание + доп. игры). */
export async function hasGameDate(hallId, halls, date) {
  let overrides = {};
  try {
    const ov = await api.getTimeOverrides(hallId);
    overrides = (ov && ov.overrides) || {};
  } catch (_) { /* сеть недоступна — считаем по расписанию */ }
  return hasGameOn(hallId, halls, date, overrides);
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
  // Единый источник правды для поиска игровых дат — upcomingDates().
  const [date] = await upcomingDates(hallId, cfg.halls, 1);
  if (!date) return null;
  return describeGame(hallId, date, cfg.halls[hallId].name);
}

/** Расписание залов текстом (без системных имён — только названия). */
export async function scheduleText() {
  const cfg = await getConfigCached();
  const lines = ['📅 Расписание игр:'];
  for (const h of Object.values(cfg.halls)) {
    const schedule = h.schedule || [];
    if (schedule.length === 0) {
      lines.push(`\n${h.name}: график не задан`);
      continue;
    }
    const days = schedule
      .map((s) => ({ Tuesday: 'вт', Thursday: 'чт', Friday: 'пт', Monday: 'пн', Wednesday: 'ср', Saturday: 'сб', Sunday: 'вс' }[s.day]))
      .join('/');
    const from = String(schedule[0].from).padStart(2, '0');
    const to = String(schedule[0].to).padStart(2, '0');
    lines.push(`\n${h.name}: ${days}, ${from}:00–${to}:00`);
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
