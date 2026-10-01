// ============================================================
// Диалоговый поток команд/кнопок (работает БЕЗ ИИ).
// Все мутации — только через подтверждение.
// ============================================================

import { InlineKeyboard } from 'grammy';
import { getConfigCached, upcomingDates, describeGame, doSignup, doCancel, scheduleText, nearestGame } from '../game.js';
import { api, todayMSK } from '../api.js';
import { mainMenu, hallPicker, confirm, menuHint, siteUrl } from '../keyboards.js';
import { getLink, upsertLink } from '../db.js';
import { log } from '../logger.js';

// То же правило, что на сервере: 3–5 слов, буквы/дефис/апостроф.
const NAME_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'\-]*(?:\s+[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'\-]*){2,4}$/;

// Стоп-слова: если хотя бы одно слово фразы совпадает — это не ФИО, а запрос.
// Проверяем по целым словам (не подстроки), чтобы не задеть фамилии
// вроде «Залевский» или «Игрушкин».
const COMMAND_WORDS = new Set([
  'запиши', 'запишите', 'записать', 'записаться', 'записал',
  'отмени', 'отмените', 'отменить', 'удали', 'удалите', 'удалить',
  'мои', 'игры', 'игра', 'игру', 'расписание', 'расписании', 'когда',
  'меню', 'помощь', 'подпишись', 'подписка', 'хочу', 'можно',
  'зал', 'зале', 'сегодня', 'завтра', 'послезавтра',
  'понедельник', 'вторник', 'среду', 'среда', 'четверг', 'пятницу', 'пятница',
  'субботу', 'суббота', 'воскресенье'
]);

/** Похоже ли сообщение на команду-запрос, а не на ФИО. */
function looksLikeCommand(text) {
  const words = String(text).toLowerCase().split(/[\s,]+/).filter(Boolean);
  return words.some((w) => COMMAND_WORDS.has(w));
}

// Ожидающие подтверждения ФИО при добавлении нового участника: telegramId → имя.
const pendingName = new Map();

/** Переслать главное меню. */
export async function sendMenu(ctx, text = '🏀 Главное меню') {
  await ctx.reply(`${text}\n${menuHint}`, { reply_markup: mainMenu() });
}

/** Нормализация ФИО для сравнения. */
function normalizeName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
}

/** Найти игрока в базе по введённому ФИО. Возвращает имя из базы или null. */
async function matchPlayerName(typed) {
  const all = await api.getAllPlayers();
  const target = normalizeName(typed);
  for (const names of Object.values(all)) {
    for (const n of names) {
      if (normalizeName(n) === target) return n;
    }
  }
  return null;
}

// Валидация введённого ФИО (та же логика, что на сервере): 3–5 слов.
function validateName(input) {
  const name = String(input || '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'ФИО не может быть пустым.' };
  if (name.length > 80) return { error: 'ФИО слишком длинное (максимум 80 символов).' };
  if (!NAME_REGEX.test(name)) {
    return {
      error: 'ФИО должно состоять из 3–5 слов: Фамилия Имя Отчество ' +
        '(только буквы, дефис и апостроф).\nПример: Иванов Иван Иванович'
    };
  }
  return { name };
}

// Привести ФИО к виду «Фамилия Имя Отчество» (каждое слово с заглавной,
// в т.ч. после дефиса: Петрова-Сидорова).
function prettifyName(name) {
  return name
    .split(' ')
    .map((w) => w.toLowerCase().replace(/(^|[-'])([a-zа-яё])/g, (_, p, c) => p + c.toUpperCase()))
    .join(' ');
}

/** Привязать telegram_id к ФИО (после проверки/создания игрока). */
async function linkPlayer(ctx, playerName) {
  await upsertLink({
    telegramId: ctx.from.id,
    playerName,
    username: ctx.from.username || null,
    firstName: ctx.from.first_name || null,
    lastName: ctx.from.last_name || null
  });
}

/**
 * Привязка профиля по введённому ФИО.
 * 1) Сначала ищем совпадение в базе.
 * 2) Если нет — валидируем ФИО и предлагаем добавить нового участника.
 */
export async function tryLinkByName(ctx, typed) {
  const raw = String(typed || '').trim();

  // Стоп-слова: типичные фразы-команды не должны приниматься за ФИО.
  // Например, «запиши меня на четверг» формально похоже на 3 слова.
  if (looksLikeCommand(raw)) {
    return false; // отдаём дальше — ИИ/командам
  }

  // Похоже ли это вообще на ФИО? Если нет — это не наша команда (отдаём ИИ).
  if (!NAME_REGEX.test(raw)) {
    // Но если пользователь уже пытался ввести имя (есть буквы/пробелы) и не привязан —
    // подскажем корректный формат, чтобы он не потерялся.
    const link = await getLink(ctx.from.id);
    if (!link?.player_name && /[A-Za-zА-Яа-яЁё]/.test(raw) && raw.includes(' ')) {
      const v = validateName(raw);
      await ctx.reply(`⚠️ ${v.error || 'Проверьте ФИО.'}`);
      return true;
    }
    return false;
  }

  // 1. Ищем существующего игрока.
  const matched = await matchPlayerName(raw);
  if (matched) {
    await linkPlayer(ctx, matched);
    await ctx.reply(
      `✅ Привязано: «${matched}».\nТеперь можно записываться и отменять.`,
      { reply_markup: mainMenu() }
    );
    return true;
  }

  // Если пользователь уже привязан — не принимаем произвольный текст за ФИО
  // (иначе фраза «запиши меня на четверг» создала бы мусорного игрока).
  // Отдаём дальше ИИ/командам.
  const existing = await getLink(ctx.from.id);
  if (existing?.player_name) return false;

  // 2. Совпадения нет — валидируем и предлагаем добавить нового игрока.
  const v = validateName(raw);
  if (v.error) {
    await ctx.reply(`⚠️ ${v.error}`);
    return true;
  }
  const pretty = prettifyName(v.name);
  await ctx.reply(
    `Игрока «${pretty}» нет в базе.\n\nДобавить вас как нового участника с таким ФИО?`,
    {
      reply_markup: new InlineKeyboard()
        .text('✅ Да, добавить', 'link:create')
        .row()
        .text('✖️ Нет', 'link:cancel')
    }
  );
  // Запоминаем предложенное имя для подтверждения.
  pendingName.set(ctx.from.id, pretty);
  return true;
}

/** Подтверждение «добавить нового участника». */
export async function confirmCreatePlayer(ctx) {
  const name = pendingName.get(ctx.from.id);
  pendingName.delete(ctx.from.id);
  await ctx.answerCallbackQuery?.();

  if (!name) {
    await ctx.reply('Нечего добавлять. Отправьте ваше ФИО (Фамилия Имя Отчество).');
    return;
  }
  try {
    const res = await api.addPlayerToDirectory(name);
    await linkPlayer(ctx, res.name || name);
    await ctx.reply(
      `✅ Готово! Вы добавлены как «${res.name || name}».\nТеперь можно записываться и отменять.`,
      { reply_markup: mainMenu() }
    );
  } catch (e) {
    log.error('addPlayerToDirectory:', e.message);
    await ctx.reply(`Не удалось добавить: ${e.message}`);
  }
}

/** Отмена добавления нового участника. */
export async function cancelCreatePlayer(ctx) {
  pendingName.delete(ctx.from.id);
  await ctx.answerCallbackQuery?.();
  await ctx.reply('Отменено. Отправьте правильное ФИО (Фамилия Имя Отчество).');
}

/** /start и глубокие ссылки. */
export async function handleStart(ctx, payload) {
  const from = ctx.from;
  await upsertLink({
    telegramId: from.id,
    username: from.username || null,
    firstName: from.first_name || null,
    lastName: from.last_name || null
  });

  if (payload && payload.startsWith('link_')) {
    // Deep-link с сайта: link_<playerId>_<encoded name>
    const parts = payload.split('_');
    const playerId = Number(parts[1]);
    const name = decodeURIComponent(parts.slice(2).join('_') || '');
    if (playerId && name) {
      await upsertLink({
        telegramId: from.id, playerId, playerName: name,
        username: from.username || null,
        firstName: from.first_name || null, lastName: from.last_name || null
      });
      await ctx.reply(
        `✅ Готово! Вы привязаны как «${name}».\nТеперь можно записываться и отменять прямо здесь.`,
        { reply_markup: mainMenu() }
      );
      return;
    }
  }

  if (payload === 'subscribe') {
    await ctx.reply('🔔 Уведомления включены. Буду напоминать об играх.', { reply_markup: mainMenu() });
    return;
  }

  const link = await getLink(from.id);
  if (link && link.player_name) {
    await ctx.reply(
      `🏀 С возвращением, ${link.player_name}!\n${menuHint}`,
      { reply_markup: mainMenu() }
    );
    return;
  }

  await ctx.reply(
    '🏀 Привет! Я бот записи на баскетбол Ball76.\n\n' +
    'ЛОКОМОТИВ — вт/чт 21:00\nАТЛАНТ — пт 21:00\n\n' +
    'Чтобы записываться, отправьте ваше ФИО (Фамилия Имя Отчество).\n' +
    'Если вас ещё нет в базе — я предложу добавить вас как нового участника.\n\n' +
    `🌐 Все записи можно посмотреть на сайте: ${siteUrl}`,
    { reply_markup: mainMenu() }
  );
}

/** Кнопка «Записаться». */
export async function startSignup(ctx) {
  const link = await getLink(ctx.from.id);
  if (!link || !link.player_name) {
    await ctx.reply('Сначала привяжите профиль: отправьте ваше ФИО (Фамилия Имя Отчество).');
    return;
  }
  const cfg = await getConfigCached();
  await ctx.reply('Выберите зал:', { reply_markup: hallPicker(cfg.halls, 'signup') });
}

/** Кнопка «Отменить». */
export async function startCancel(ctx) {
  const link = await getLink(ctx.from.id);
  if (!link || !link.player_name) {
    await ctx.reply('Сначала привяжите профиль: отправьте ваше ФИО (Фамилия Имя Отчество).');
    return;
  }
  const cfg = await getConfigCached();
  await ctx.reply('Выберите зал для отмены:', { reply_markup: hallPicker(cfg.halls, 'cancel') });
}

/** Выбран зал → сразу подтверждение на БЛИЖАЙШУЮ игру (без списка дат). */
export async function chooseHall(ctx, action, hallId) {
  const cfg = await getConfigCached();
  const dates = await upcomingDates(hallId, cfg.halls, 1);
  if (dates.length === 0) { await ctx.reply('Нет доступных игр.'); return; }
  // Сразу переходим к подтверждению ближайшей даты — без выбора из списка.
  await chooseDate(ctx, action, hallId, dates[0]);
}

/** Выбрана дата → подтверждение. */
export async function chooseDate(ctx, action, hallId, date) {
  const cfg = await getConfigCached();
  const g = await describeGame(hallId, date, cfg.halls[hallId].name);
  const verb = action === 'signup' ? 'Записать' : 'Отменить запись';
  await ctx.reply(
    `${verb}?\n\n${g.hallName}, ${g.humanDate}, ${g.startTime}\nЗаписано: ${g.count}/18`,
    { reply_markup: confirm(action, hallId, date) }
  );
}

/** Подтверждено → выполнить. */
export async function doAction(ctx, action, hallId, date) {
  const link = await getLink(ctx.from.id);
  if (!link || !link.player_name) {
    await ctx.reply('Не знаю ваше ФИО. Отправьте его сообщением (Фамилия Имя Отчество).');
    return;
  }
  const res = action === 'signup'
    ? await doSignup(hallId, date, link.player_name)
    : await doCancel(hallId, date, link.player_name);
  await ctx.reply(res.message, { reply_markup: mainMenu() });
}

/** «Мои игры» — где записан пользователь. */
export async function myGames(ctx) {
  const link = await getLink(ctx.from.id);
  if (!link || !link.player_name) {
    await ctx.reply('Сначала привяжите профиль: отправьте ваше ФИО.');
    return;
  }
  const cfg = await getConfigCached();
  const name = link.player_name;
  const norm = normalizeName(name);
  const lines = [];
  for (const [hallId, hall] of Object.entries(cfg.halls)) {
    const dates = await upcomingDates(hallId, cfg.halls, 4);
    for (const d of dates) {
      const players = await api.getPlayers(hallId, d).catch(() => []);
      if (players.some((p) => normalizeName(p) === norm)) {
        const g = await describeGame(hallId, d, hall.name);
        lines.push(`• ${g.humanDate} — ${hall.name} ${g.startTime}`);
      }
    }
  }
  await ctx.reply(
    lines.length ? `📋 Ваши игры:\n${lines.join('\n')}` : 'У вас пока нет активных записей.',
    { reply_markup: mainMenu() }
  );
}

/** Расписание. */
export async function showSchedule(ctx) {
  const text = await scheduleText();
  const cfg = await getConfigCached();
  const near = [];
  for (const hallId of Object.keys(cfg.halls)) {
    const g = await nearestGame(hallId).catch(() => null);
    if (g) near.push(`• ${g.hallName}: ${g.humanDate} ${g.startTime} (${g.count}/18)`);
  }
  await ctx.reply(`${text}\n\n🔜 Ближайшие:\n${near.join('\n')}`, { reply_markup: mainMenu() });
}
