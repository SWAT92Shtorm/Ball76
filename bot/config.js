// ============================================================
// Ball76 bot — конфигурация.
// Все секреты берутся из переменных окружения (.env на сервере).
// В git .env не попадает (см. .gitignore).
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
  // Кастомный корень Telegram API. Нужен только для обхода блокировки
  // через прокси (Cloudflare Worker). При пиннинге IP оставить пустым.
  // Пример: https://tg-proxy.<account>.workers.dev
  telegramApiRoot: optional('TELEGRAM_API_ROOT'),

  // --- LLM (OpenAI-совместимый; по умолчанию Google Gemini, доступный из РФ) ---
  // Внимание: Groq заблокирован для РФ — не использовать.
  llm: {
    baseUrl: optional('LLM_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
    apiKey: optional('LLM_API_KEY'),
    model: optional('LLM_MODEL', 'gemini-2.0-flash')
  },

  // --- Ball76 API ---
  apiBaseUrl: optional('API_BASE_URL', 'http://127.0.0.1:8080'),

  // --- PostgreSQL ---
  databaseUrl: required('DATABASE_URL'),

  // --- Прочее ---
  tz: optional('TZ', 'Europe/Moscow'),
  // Группы для рассылок (через запятую): -100123...,-100456...
  notifyGroupIds: optional('NOTIFY_GROUP_IDS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // За сколько часов до игры слать напоминание
  reminderHoursBefore: Number(optional('REMINDER_HOURS_BEFORE', '3')),
  // Порог «добора»: за сколько часов проверять недобор
  gatherHoursBefore: Number(optional('GATHER_HOURS_BEFORE', '24'))
};

// Доступно ли ИИ (ключ задан)
export const aiEnabled = Boolean(config.llm.apiKey);
