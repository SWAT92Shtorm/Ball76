// ============================================================
// bot-summarizer — конфигурация.
// Все секреты берутся из переменных окружения (.env на сервере).
// ============================================================

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Не задана обязательная переменная окружения: ${name}`);
  }
  return v.trim();
}

function optional(name, def = '') {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : def;
}

export const config = {
  // --- Telegram ---
  botToken: required('TELEGRAM_BOT_TOKEN'),
  // Кастомный корень Telegram API (для обхода блокировки через прокси).
  // При пиннинге IP (extra_hosts) оставить пустым.
  telegramApiRoot: optional('TELEGRAM_API_ROOT'),

  // --- ИИ: GigaChat (Sber) ---
  llm: {
    gigachatAuthKey: required('GIGACHAT_AUTH_KEY'),
    gigachatScope: optional('GIGACHAT_SCOPE', 'GIGACHAT_API_PERS'),
    gigachatModel: optional('GIGACHAT_MODEL', 'GigaChat-2'),
    gigachatAuthUrl: optional('GIGACHAT_AUTH_URL', 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'),
    gigachatBaseUrl: optional('GIGACHAT_BASE_URL', 'https://api.giga.chat/v1')
  },

  // --- Хранение сообщений ---
  // Путь к файлу с сообщениями за текущий день (JSON).
  dataFile: optional('DATA_FILE', '/data/messages.json'),

  // --- Прочее ---
  tz: optional('TZ', 'Europe/Moscow'),

  // Фразы-триггеры запроса пересказа (бот отвечает, если сообщение содержит
  // упоминание бота ИЛИ одну из этих фраз).
  triggerWords: optional('TRIGGER_WORDS', 'что обсуждали,перескажи,о чём говорили,о чем говорили,кратко,итог,резюме')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
};

export const aiEnabled = Boolean(config.llm.gigachatAuthKey);
