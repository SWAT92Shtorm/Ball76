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

  // --- LLM: единственный провайдер — GigaChat (Sber) ---
  // Свой протокол: OAuth-токен + legacy `functions` (современное `tools`
  // GigaChat не поддерживает). Включается переменной GIGACHAT_AUTH_KEY
  // (base64 от ClientID:ClientSecret).
  llm: {
    // Authorization key = base64(ClientID:ClientSecret) из личного кабинета Sber.
    gigachatAuthKey: optional('GIGACHAT_AUTH_KEY'),
    gigachatScope: optional('GIGACHAT_SCOPE', 'GIGACHAT_API_PERS'),
    gigachatModel: optional('GIGACHAT_MODEL', 'GigaChat-2'),
    gigachatAuthUrl: optional('GIGACHAT_AUTH_URL', 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'),
    gigachatBaseUrl: optional('GIGACHAT_BASE_URL', 'https://api.giga.chat/v1')
  },

  // --- Ball76 API ---
  apiBaseUrl: optional('API_BASE_URL', 'http://127.0.0.1:8080'),

  // --- Сайт записи (показывается пользователям в боте) ---
  siteUrl: optional('SITE_URL', 'https://ball76.duckdns.org'),

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
  gatherHoursBefore: Number(optional('GATHER_HOURS_BEFORE', '24')),

  // ИИ отвечает ТОЛЬКО когда бота упомянули (@username) или ответили на его
  // сообщение. Работает и в личке, и в группе. Кнопки/команды (/signup, /cancel,
  // /schedule, /mygames) продолжают работать всегда.
  aiOnlyOnMention: optional('AI_ONLY_ON_MENTION', 'true') !== 'false'
};

// Провайдер ИИ — всегда GigaChat (единственная поддерживаемая модель).
export const llmProvider = 'gigachat';

// Доступно ли ИИ (задан ключ GigaChat)
export const aiEnabled = Boolean(config.llm.gigachatAuthKey);
