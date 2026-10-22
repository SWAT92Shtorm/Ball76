// ============================================================
// Ball76 bot — точка входа.
// long polling + команды + ИИ + планировщик.
// ============================================================

import { Bot } from 'grammy';
import { config } from './config.js';
import { log } from './logger.js';
import { pool } from './db.js';

import {
  handleStart, startSignup, startCancel, chooseHall, chooseDate,
  doAction, myGames, showSchedule, tryLinkByName, sendMenu,
  confirmCreatePlayer, cancelCreatePlayer
} from './handlers/flow.js';
import { getConfigCached } from './game.js';
import { hallPicker } from './keyboards.js';
import { handleText, aiEnabled, confirmAction } from './handlers/ai.js';
import { registerChat, handleGroupMention } from './handlers/group.js';
import { handlePoll, handleReaction, handlePollAnswer } from './handlers/poll.js';
import { startScheduler, createPollForHall } from './scheduler.js';

// --- Создание бота (с поддержкой кастомного API-корня для обхода блокировки) ---
const botConfig = {};
if (config.telegramApiRoot) {
  botConfig.client = { apiRoot: config.telegramApiRoot };
  log.info(`Telegram API root: ${config.telegramApiRoot}`);
}
const bot = new Bot(config.botToken, botConfig);

// --- Логирование входящих апдейтов + регистрация чатов ---
bot.use(async (ctx, next) => {
  const t = ctx.message?.text || ctx.callbackQuery?.data || ctx.chat?.id || '?';
  log.info(`← апдейт от ${ctx.from?.id || '?'} (${ctx.chat?.type || '?'}): ${String(t).slice(0, 60)}`);
  if (ctx.chat) await registerChat(ctx);
  return next();
});

// --- Команды ---
bot.command('start', async (ctx) => {
  const payload = ctx.match || '';
  await handleStart(ctx, payload);
});
bot.command('menu', (ctx) => sendMenu(ctx));
bot.command('signup', (ctx) => startSignup(ctx));
bot.command('cancel', (ctx) => startCancel(ctx));
bot.command('mygames', (ctx) => myGames(ctx));
bot.command('schedule', (ctx) => showSchedule(ctx));
bot.command('help', (ctx) =>
  ctx.reply(
    'Команды:\n/signup — записаться\n/cancel — отменить\n/mygames — мои игры\n/schedule — расписание\n\n' +
    'Или просто напишите: «запиши меня на четверг».\n\n' +
    `🌐 Все записи на сайте: ${config.siteUrl}`
  )
);

// --- Callback-кнопки ---
bot.callbackQuery('act:menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendMenu(ctx, '🏀 Меню');
});
bot.callbackQuery('act:signup', async (ctx) => { await ctx.answerCallbackQuery(); await startSignup(ctx); });
bot.callbackQuery('act:cancel', async (ctx) => { await ctx.answerCallbackQuery(); await startCancel(ctx); });
bot.callbackQuery('act:mygames', async (ctx) => { await ctx.answerCallbackQuery(); await myGames(ctx); });
bot.callbackQuery('act:schedule', async (ctx) => { await ctx.answerCallbackQuery(); await showSchedule(ctx); });

// Запустить опрос: показать выбор зала.
bot.callbackQuery('act:poll', async (ctx) => {
  await ctx.answerCallbackQuery();
  const cfg = await getConfigCached();
  await ctx.reply('Выберите зал для опроса:', { reply_markup: hallPicker(cfg.halls, 'poll') });
});

// Выбран зал → запустить опрос на ближайшую игру.
bot.callbackQuery(/^poll:hall:([a-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const res = await createPollForHall(bot, ctx.match[1]);
  await ctx.reply(res.message);
});

// Добавление нового игрока в базу по ФИО из Telegram
bot.callbackQuery('link:create', (ctx) => confirmCreatePlayer(ctx));
bot.callbackQuery('link:cancel', (ctx) => cancelCreatePlayer(ctx));

// Выбор зала: signup:hall:<sysName> | cancel:hall:<sysName>
// sysName — произвольный slug зала из БД (hall1, hall2, hall3, ...).
bot.callbackQuery(/^(signup|cancel):hall:([a-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await chooseHall(ctx, ctx.match[1], ctx.match[2]);
});

// Выбор даты: signup:date:<sysName>:2026-10-02
bot.callbackQuery(/^(signup|cancel):date:([a-z0-9_-]+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await chooseDate(ctx, ctx.match[1], ctx.match[2], ctx.match[3]);
});

// Подтверждение: confirm:signup:<sysName>:2026-10-02
bot.callbackQuery(/^confirm:(signup|cancel):([a-z0-9_-]+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await confirmAction(ctx, ctx.match[1], ctx.match[2], ctx.match[3]);
});

// --- Текст ---
bot.on('message:text', async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  const rawText = ctx.message.text || '';
  // Устойчивое распознавание @упоминания: не отличаем регистр и разделители,
  // т.к. пользователи пишут @Ball76_bot / @ball76bot вместо точного @Ball76bot.
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const botUsername = norm(ctx.me?.username || '');
  const mentioned = Boolean(botUsername) && norm(rawText).includes(botUsername);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me?.id;
  const cleaned = rawText.replace(/@\w+/g, '').trim();

  // ==== Группы ====
  if (isGroup) {
    // Privacy mode обычно ON — бот и так видит только упоминания/ответы.
    // Реагируем ТОЛЬКО на упоминание бота или ответ на его сообщение.
    if (mentioned || isReplyToBot) {
      await handleGroupMention(ctx);
    }
    return;
  }

  // ==== Личка ====
  // Привязка профиля по ФИО — работает всегда (это не ИИ).
  if (await tryLinkByName(ctx, rawText)) return;

  // Режим «ИИ только по @упоминанию»: без тега ИИ молчит.
  if (config.aiOnlyOnMention && !mentioned && !isReplyToBot) {
    await sendMenu(
      ctx,
      `Напишите @${ctx.me?.username || 'бота'}, чтобы обратиться к ИИ. Или выберите действие:`
    );
    return;
  }

  // ИИ (текст без @упоминания)
  const answered = await handleText(ctx, cleaned);
  if (!answered) {
    await sendMenu(ctx, 'ИИ недоступен, но команды работают');
  }
});

// --- Опросы: бот видит опрос (privacy mode DISABLED), парсит заголовок ---
bot.on('message:poll', (ctx) => handlePoll(ctx));

// --- Ответ на опрос: записываем на игру тех, кто ответил на опрос ---
bot.on('poll_answer', (ctx) => handlePollAnswer(ctx));

// --- Реакции: записываем на игру тех, кто отреагировал на опрос ---
bot.on('message_reaction', (ctx) => handleReaction(ctx));

// --- Обработка ошибок ---
bot.catch((err) => {
  log.error('Bot error:', err?.error?.message || err?.message || err);
});

// --- Запуск ---
async function main() {
  // Проверка БД
  try {
    await pool.query('SELECT 1');
    log.info('БД подключена');
  } catch (e) {
    log.error('Не удалось подключиться к БД:', e.message);
  }

  await bot.api.setMyCommands([
    { command: 'start', description: 'Начать' },
    { command: 'signup', description: 'Записаться на игру' },
    { command: 'cancel', description: 'Отменить запись' },
    { command: 'mygames', description: 'Мои игры' },
    { command: 'schedule', description: 'Расписание' },
    { command: 'help', description: 'Помощь' }
  ]).catch((e) => log.warn('setMyCommands:', e.message));

  startScheduler(bot);

  log.info(`Бот запускается… ИИ: ${aiEnabled ? 'включён' : 'выключен (нет ключа)'}`);

  // Канал до Telegram в РФ нестабилен (ping-IP, обход блокировки) — polling
  // может рваться. Вместо падения переподключаемся с нарастающей паузой.
  let stopping = false;
  const stop = () => { stopping = true; bot.stop(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  let attempt = 0;
  while (!stopping) {
    try {
      await bot.start({
        allowed_updates: ['message', 'callback_query', 'message_reaction', 'message_reaction_count', 'poll_answer', 'chat_member', 'my_chat_member'],
        onStart: (info) => {
          attempt = 0;
          log.info(`Бот @${info.username} запущен (long polling)`);
        }
      });
      // bot.start() завершился штатно (stop) — выходим
      break;
    } catch (e) {
      if (stopping) break;
      attempt++;
      const delay = Math.min(30, 2 ** attempt); // 2,4,8,16,30… сек
      log.error(`Polling оборвался (${e.message}). Переподключение через ${delay} с`);
      await new Promise((r) => setTimeout(r, delay * 1000));
    }
  }
  log.info('Бот остановлен');
  process.exit(0);
}

main().catch((e) => {
  log.error('Фатальная ошибка:', e.message);
  process.exit(1);
});
