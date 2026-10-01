// ============================================================
// Диалоговый поток команд/кнопок (работает БЕЗ ИИ).
// Все мутации — только через подтверждение.
// ============================================================

import { getConfigCached, upcomingDates, describeGame, doSignup, doCancel, scheduleText, nearestGame } from '../game.js';
import { api, todayMSK } from '../api.js';
import { mainMenu, hallPicker, datePicker, confirm, menuHint } from '../keyboards.js';
import { getLink, upsertLink } from '../db.js';
import { log } from '../logger.js';

// То же правило, что на сервере: 3–5 слов, буквы/дефис/апостроф.
const NAME_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'\-]*(?:\s+[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'\-]*){2,4}$/;

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

/** Привязка профиля по введённому ФИО. */
export async function tryLinkByName(ctx, typed) {
  if (!NAME_REGEX.test(String(typed).trim())) return false;
  const matched = await matchPlayerName(typed);
  if (!matched) {
    await ctx.reply(
      'Такого игрока нет в базе. ФИО должно точно совпадать с тем, как вы записаны на сайте ' +
      '(Фамилия Имя Отчество). Либо запишитесь на сайте — и нажмите там «Подписаться».'
    );
    return true; // это была попытка ввести имя — обработали
  }
  await upsertLink({
    telegramId: ctx.from.id,
    playerName: matched,
    username: ctx.from.username || null,
    firstName: ctx.from.first_name || null,
    lastName: ctx.from.last_name || null
  });
  await ctx.reply(
    `✅ Привязано: «${matched}».\nТеперь можно записываться и отменять.`,
    { reply_markup: mainMenu() }
  );
  return true;
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
    'Чтобы записываться, сначала привяжите профиль: отправьте ваше ФИО ' +
    '(Фамилия Имя Отчество) — точно как на сайте.',
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

/** Выбран зал → показать даты. */
export async function chooseHall(ctx, action, hallId) {
  const cfg = await getConfigCached();
  const dates = await upcomingDates(hallId, cfg.halls, 6);
  if (dates.length === 0) { await ctx.reply('Нет доступных дат.'); return; }
  await ctx.reply(
    `${cfg.halls[hallId].name} — выберите дату:`,
    { reply_markup: datePicker(action, hallId, dates) }
  );
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
