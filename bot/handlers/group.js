// ============================================================
// Обработка групп: регистрация чата, реакция на @bot и команды.
// Privacy mode ON: бот видит только упоминания/ответы и команды.
// ИИ отвечает на упоминание; если ИИ недоступен — канонический ответ.
// ============================================================

import { upsertChat } from '../db.js';
import { getConfigCached, nearestGame, scheduleText } from '../game.js';
import { handleText } from './ai.js';
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

/** Ответ в группе на упоминание бота. Возвращает true, если ответил ИИ. */
export async function handleGroupMention(ctx) {
  // Текст без @упоминания — именно его отправляем в ИИ.
  const cleaned = (ctx.message?.text || '').replace(/@\w+/g, '').trim();

  // Приоритет — ИИ (он понимает намерение и вызывает инструменты).
  try {
    if (await handleText(ctx, cleaned)) return true;
  } catch (e) {
    log.warn('Group AI:', e.message);
  }

  // Fallback: ИИ недоступен — канонический ответ.
  await showGroupSchedule(ctx);
  return false;
}

/** Показать расписание (для группы). */
export async function showGroupSchedule(ctx) {
  const cfg = await getConfigCached();
  const near = [];
  for (const hallId of Object.keys(cfg.halls)) {
    const g = await nearestGame(hallId).catch(() => null);
    if (g) near.push(`${g.hallName}: ${g.humanDate} ${g.startTime} (${g.count}/18)`);
  }
  await ctx.reply(`📅 Ближайшие игры:\n${near.join('\n')}`);
}
