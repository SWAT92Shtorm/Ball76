// ============================================================
// Обработчик свободного текста через ИИ (Groq + function calling).
// ИИ понимает запрос → вызывает tool → при мутации просим подтверждение.
// ============================================================

import { InlineKeyboard } from 'grammy';
import { chat, aiEnabled } from '../llm.js';
import { toolDefs, runTool, execConfirmed } from '../tools.js';
import { buildSystemPrompt } from '../prompts/system.js';
import { getConfigCached } from '../game.js';
import { getLink } from '../db.js';
import { mainMenu } from '../keyboards.js';
import { log } from '../logger.js';

// Краткая память диалога (в оперативной памяти). Для клуба этого достаточно.
const history = new Map(); // telegramId → [{role, content}]
const MAX_HISTORY = 8;

function pushHistory(id, msg) {
  const arr = history.get(id) || [];
  arr.push(msg);
  while (arr.length > MAX_HISTORY) arr.shift();
  history.set(id, arr);
}

/** Есть ли ИИ. */
export { aiEnabled };

/**
 * Обработать свободный текст.
 * Возвращает true, если ответил; false — если ИИ недоступен (нужен fallback).
 */
export async function handleText(ctx) {
  if (!aiEnabled) return false;

  const text = (ctx.message.text || '').trim();
  if (!text) return true;

  const link = await getLink(ctx.from.id);
  const cfg = await getConfigCached();
  const system = buildSystemPrompt({ playerName: link?.player_name || null, halls: cfg.halls });

  const msgs = [
    { role: 'system', content: system },
    ...(history.get(ctx.from.id) || []),
    { role: 'user', content: text }
  ];

  let assistant;
  try {
    assistant = await chat(msgs, toolDefs);
  } catch (e) {
    log.error('ИИ недоступен:', e.message);
    await ctx.reply(
      'ИИ временно недоступен 😔 Пользуйтесь кнопками:',
      { reply_markup: mainMenu() }
    );
    return true;
  }

  // Вариант 1: модель вызвала инструмент
  if (assistant.tool_calls && assistant.tool_calls.length) {
    const call = assistant.tool_calls[0];
    let args = {};
    try { args = JSON.parse(call.function.arguments || '{}'); } catch (_) {}

    const result = await runTool(call.function.name, args, {
      telegramId: ctx.from.id,
      playerName: link?.player_name || null
    });

    // Мутация → подтверждение кнопками
    if (result.pendingAction) {
      const { action, hallId, date, hallName } = result.pendingAction;
      const verb = action === 'signup' ? 'Записать' : 'Отменить запись';
      await ctx.reply(
        `${verb}?\n\n${hallName}, ${date}`,
        {
          reply_markup: new InlineKeyboard()
            .text('✅ Да', `confirm:${action}:${hallId}:${date}`)
            .text('❌ Нет', 'act:menu')
        }
      );
      return true;
    }

    // Ответ без мутации: просим модель сформулировать текст
    pushHistory(ctx.from.id, { role: 'user', content: text });
    pushHistory(ctx.from.id, assistant);
    pushHistory(ctx.from.id, {
      role: 'tool', tool_call_id: call.id, content: result.text
    });
    try {
      const final = await chat([
        { role: 'system', content: system },
        ...(history.get(ctx.from.id) || [])
      ]);
      const reply = final.content || result.text;
      pushHistory(ctx.from.id, { role: 'assistant', content: reply });
      await ctx.reply(reply);
    } catch (e) {
      await ctx.reply(result.text);
    }
    return true;
  }

  // Вариант 2: обычный текстовый ответ
  const reply = assistant.content || 'Не понял запрос. Попробуйте иначе.';
  pushHistory(ctx.from.id, { role: 'user', content: text });
  pushHistory(ctx.from.id, { role: 'assistant', content: reply });
  await ctx.reply(reply, { reply_markup: mainMenu() });
  return true;
}

/** Выполнить подтверждённое действие (после нажатия «Да»). */
export async function confirmAction(ctx, action, hallId, date) {
  const link = await getLink(ctx.from.id);
  if (!link || !link.player_name) {
    await ctx.reply('Не знаю ваше ФИО — сначала привяжите профиль.');
    return;
  }
  await ctx.answerCallbackQuery?.();
  const res = await execConfirmed(action, hallId, date, link.player_name);
  await ctx.reply(res.message, { reply_markup: mainMenu() });
}
