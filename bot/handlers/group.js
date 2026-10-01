// ============================================================
// Обработка групп: регистрация чата, реакция на @bot и команды.
// Privacy mode ON: бот видит только упоминания/ответы и команды.
// ============================================================

import { upsertChat } from '../db.js';
import { getConfigCached, nearestGame, scheduleText } from '../game.js';
import { log } from '../logger.js';

/** Запомнить группу (при добавлении бота / любом апдейте). */
export async function registerChat(ctx) {
  const chat = ctx.chat;
  if (!chat) return;
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';
  try {
    await upsertChat({
      chatId: chat.id,
      title: chat.title || null,
      chatType: chat.type,
      isGroup
    });
  } catch (e) {
    log.warn('registerChat:', e.message);
  }
}

/** Ответ в группе на упоминание бота. */
export async function handleGroupMention(ctx) {
  const text = (ctx.message?.text || '').replace(/@\w+/g, '').trim().toLowerCase();

  if (!text || /расписан|когда|игр/.test(text)) {
    const cfg = await getConfigCached();
    const near = [];
    for (const hallId of Object.keys(cfg.halls)) {
      const g = await nearestGame(hallId).catch(() => null);
      if (g) near.push(`${g.hallName}: ${g.humanDate} ${g.startTime} (${g.count}/18)`);
    }
    await ctx.reply(`📅 Ближайшие игры:\n${near.join('\n')}`);
    return;
  }

  // Для записи/отмены отправляем в личку
  if (/запиш|записат|отмен/.test(text)) {
    await ctx.reply(
      'Чтобы записаться или отменить, напишите мне в личку — там удобнее подтверждать.',
      { reply_markup: undefined }
    );
    return;
  }

  await ctx.reply('Я умею: подсказать расписание. Для записи напишите в личку.');
}
