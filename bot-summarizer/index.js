// ============================================================
// bot-summarizer — Telegram-бот.
// Читает сообщения в группе (privacy mode OFF), хранит их в файле
// за текущий день. Если бота спросили «что тут обсуждали» (упоминание
// или фраза-триггер) — делает краткий пересказ через ИИ (GigaChat).
// ============================================================

import { Bot } from 'grammy';
import { config, aiEnabled } from './config.js';
import { log } from './logger.js';
import { addMessage, getMessages } from './store.js';
import { summarize } from './llm.js';

// --- Создание бота (с поддержкой кастомного API-корня для обхода блокировки) ---
const botConfig = {};
if (config.telegramApiRoot) {
  botConfig.client = { apiRoot: config.telegramApiRoot };
  log.info(`Telegram API root: ${config.telegramApiRoot}`);
}
const bot = new Bot(config.botToken, botConfig);

// --- Логирование входящих апдейтов ---
bot.use(async (ctx, next) => {
  const t = ctx.message?.text || ctx.chat?.id || '?';
  log.info(`← апдейт от ${ctx.from?.id || '?'} (${ctx.chat?.type || '?'}): ${String(t).slice(0, 60)}`);
  return next();
});

// --- Чтение всех текстовых сообщений в группах ---
bot.on('message:text', async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  if (!isGroup) return;

  const text = ctx.message.text || '';
  const from = ctx.from?.first_name || ctx.from?.username || String(ctx.from?.id || '?');

  // Сохраняем сообщение в файл за текущий день.
  await addMessage({
    id: ctx.message.message_id,
    chatId: ctx.chat.id,
    from,
    text,
    ts: new Date().toISOString()
  });

  // Проверяем, просят ли пересказ: упоминание бота ИЛИ фраза-триггер.
  const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
  const botUsername = norm(ctx.me?.username || '');
  const mentioned = Boolean(botUsername) && norm(text).includes(botUsername);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me?.id;
  const hasTrigger = config.triggerWords.some((w) => norm(text).includes(w));

  if (mentioned || isReplyToBot || hasTrigger) {
    await handleSummaryRequest(ctx);
  }
});

// --- Обработка запроса пересказа ---
async function handleSummaryRequest(ctx) {
  if (!aiEnabled) {
    await ctx.reply('ИИ не настроен (нет ключа GigaChat).');
    return;
  }

  const messages = await getMessages();
  // Исключаем сам запрос пересказа из истории, чтобы не пересказывать вопрос.
  const history = messages.filter((m) => m.id !== ctx.message.message_id);

  if (history.length === 0) {
    await ctx.reply('Сегодня сообщений пока не было — пересказывать нечего.');
    return;
  }

  // Формируем текст для ИИ: «Имя: сообщение» по порядку.
  const transcript = history
    .map((m) => `${m.from}: ${m.text}`)
    .join('\n');

  const systemPrompt =
    'Ты — ассистент, который делает краткий пересказ обсуждения в Telegram-группе. ' +
    'Прочитай сообщения и составь сжатый, структурированный пересказ: ' +
    'основные темы, ключевые решения и договорённости. ' +
    'Отвечай кратко и по делу, на русском языке. ' +
    'Если сообщений мало — просто коротко перескажи их суть.';

  try {
    const summary = await summarize(systemPrompt, transcript);
    // Telegram ограничивает длину сообщения ~4096 символов.
    const answer = `📋 Краткий пересказ обсуждения:\n\n${summary}`;
    await ctx.reply(answer.slice(0, 4000));
  } catch (e) {
    log.error('Ошибка пересказа:', e.message);
    await ctx.reply('Не удалось сделать пересказ. Попробуйте позже.');
  }
}

// --- Обработка ошибок ---
bot.catch((err) => {
  log.error('Bot error:', err?.error?.message || err?.message || err);
});

// --- Запуск ---
async function main() {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Начать' },
    { command: 'summary', description: 'Краткий пересказ обсуждения за сегодня' }
  ]).catch((e) => log.warn('setMyCommands:', e.message));

  bot.command('start', (ctx) =>
    ctx.reply('Привет! Я читаю сообщения в этой группе и могу сделать краткий пересказ. Напишите «что тут обсуждали» или упомяните меня.'));
  bot.command('summary', (ctx) => handleSummaryRequest(ctx));

  log.info(`Бот запускается… ИИ: ${aiEnabled ? 'включён' : 'выключен (нет ключа)'}`);

  let stopping = false;
  const stop = () => { stopping = true; bot.stop(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  let attempt = 0;
  while (!stopping) {
    try {
      await bot.start({
        allowed_updates: ['message'],
        onStart: (info) => {
          attempt = 0;
          log.info(`Бот @${info.username} запущен (long polling)`);
        }
      });
      break;
    } catch (e) {
      if (stopping) break;
      attempt++;
      const delay = Math.min(30, 2 ** attempt);
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
