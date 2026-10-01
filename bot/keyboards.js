// Клавиатуры (кнопки) для бота.
import { InlineKeyboard } from 'grammy';
import { humanDate } from './api.js';
import { config } from './config.js';

/** Главное меню. */
export function mainMenu() {
  return new InlineKeyboard()
    .text('📝 Записаться', 'act:signup')
    .text('❌ Отменить', 'act:cancel')
    .row()
    .text('📋 Мои игры', 'act:mygames')
    .text('📅 Расписание', 'act:schedule');
}

/** Выбор зала. */
export function hallPicker(halls, action) {
  const kb = new InlineKeyboard();
  for (const [id, h] of Object.entries(halls)) {
    kb.text(h.name, `${action}:hall:${id}`).row();
  }
  return kb;
}

/** Выбор даты (несколько ближайших игр зала). */
export function datePicker(action, hallId, dates) {
  const kb = new InlineKeyboard();
  dates.forEach((d) => {
    kb.text(humanDate(d), `${action}:date:${hallId}:${d}`).row();
  });
  kb.text('⬅️ Назад', 'act:menu');
  return kb;
}

/** Подтверждение действия. */
export function confirm(action, hallId, date) {
  return new InlineKeyboard()
    .text('✅ Да', `confirm:${action}:${hallId}:${date}`)
    .text('❌ Нет', 'act:menu');
}

/** Кнопка подписки на уведомления в личке. */
export function subscribeHint(botUsername) {
  return new InlineKeyboard().url(
    '🔔 Подписаться на уведомления',
    `https://t.me/${botUsername}?start=subscribe`
  );
}

export const menuHint = 'Выберите действие 👇';
