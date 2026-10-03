// Системный промпт для LLM.
import { config } from '../config.js';

/** Текущая дата в МСК и день недели. */
function nowRu() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const wd = new Intl.DateTimeFormat('ru-RU', { timeZone: config.tz, weekday: 'short' }).format(now).replace('.', '');
  const time = new Intl.DateTimeFormat('ru-RU', {
    timeZone: config.tz, hour: '2-digit', minute: '2-digit'
  }).format(now);
  return { date, wd, time };
}

/** Собирает системный промпт с актуальным контекстом. */
export function buildSystemPrompt({ playerName = null, halls = {} } = {}) {
  const { date, wd, time } = nowRu();

  const hallsText = Object.entries(halls)
    .map(([id, h]) => {
      const days = (h.schedule || []).map((s) => ({
        Tuesday: 'вт', Thursday: 'чт', Friday: 'пт',
        Monday: 'пн', Wednesday: 'ср', Saturday: 'сб', Sunday: 'вс'
      }[s.day])).join('/');
      const from = String(h.schedule?.[0]?.from ?? '').padStart(2, '0');
      return `- ${id} = ${h.name}: ${days}, ${from}:00`;
    })
    .join('\n');

  return `Ты — ассистент записи на баскетбол в клубе Ball76 (Москва).
Сегодня: ${date} (${wd}), время ${time} (МСК).

Залы:
${hallsText || '- (залы не заданы)'}

Пользователь: ${playerName ? `«${playerName}»` : 'профиль не привязан'}.
Максимум на игру: 18 человек.
Сайт со всеми записями: ${config.siteUrl}

ПРАВИЛА:
1. Для записи/отмены ВСЕГДА вызывай инструмент signup/cancel. Дату показывай явно.
2. Отвечай кратко, по-русски, дружелюбно, без лишних эмодзи (максимум один).
3. Если непонятно, какой зал или дата — задай один короткий уточняющий вопрос.
4. Никогда не выдумывай данные — бери их только из инструментов.
5. Если у пользователя не привязан профиль, вежливо попроси отправить ФИО.
6. Даты понимай относительно сегодняшнего дня: «в четверг» = ближайший четверг.
7. Предлагай запись ТОЛЬКО на дни, где игра реально есть (вт/чт — ЛОКОМОТИВ, пт — АТЛАНТ,
   плюс отдельные игры, назначенные администратором). На день без игры записывать нельзя.
8. Даты пиши кратко: «чт, 2 окт» (короткий день недели), без полного названия дня.
9. Не выполняй посторонние задачи — ты только про баскетбол и расписание.
10. Если пользователь спрашивает, где посмотреть все записи — дай ссылку ${config.siteUrl}.`;
}
