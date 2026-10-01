// ============================================================
// LLM-клиент: единственный провайдер — GigaChat (Sber), интерфейс
// chat(messages, tools).
//
//  GigaChat использует свой протокол:
//    • OAuth-токен (POST /api/v2/oauth, Authorization: Basic <authKey>),
//      живёт ~30 мин → кэшируем и обновляем заранее;
//    • для вызова инструментов использует legacy-поле `functions`
//      (современное `tools` не поддерживается) и возвращает
//      `message.function_call` вместо `tool_calls`.
//  Наружу отдаём сообщение в формате OpenAI, поэтому
//  handlers/ai.js и tools.js менять не нужно.
// ============================================================

import { config, aiEnabled, llmProvider } from './config.js';
import { log } from './logger.js';

const RETRY_DELAYS = [1000, 3000]; // при 429 / 5xx

// ==================== GigaChat: OAuth-токен с кэшем ====================

let tokenCache = { value: null, exp: 0 };
let tokenPromise = null; // защита от параллельных запросов токена

async function fetchAccessToken() {
  const res = await fetch(config.llm.gigachatAuthUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: crypto.randomUUID(),
      Authorization: `Basic ${config.llm.gigachatAuthKey}`
    },
    body: `scope=${encodeURIComponent(config.llm.gigachatScope)}`
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GigaChat OAuth ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('GigaChat: пустой access_token');

  // expires_at — миллисекунды epoch; обновляем за минуту до истечения.
  const exp = data.expires_at ? Number(data.expires_at) - 60_000 : Date.now() + 25 * 60_000;
  tokenCache = { value: data.access_token, exp };
  log.info('GigaChat: получен access token');
  return tokenCache.value;
}

async function getAccessToken(force = false) {
  if (!force && tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
  if (tokenPromise) return tokenPromise;
  tokenPromise = fetchAccessToken().finally(() => { tokenPromise = null; });
  return tokenPromise;
}

// ==================== Конвертация форматов (OpenAI → GigaChat) ====================

/** JSON.stringify без падения на циклических/нестандартных значениях. */
function safeStringify(v) {
  try {
    return JSON.stringify(v ?? {});
  } catch (_) {
    return '{}';
  }
}

/** Найти имя функции по tool_call_id (для сообщений role:'tool'). */
function findFnName(messages, toolCallId) {
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      const tc = m.tool_calls.find((c) => c.id === toolCallId);
      if (tc) return tc.function?.name;
    }
  }
  return 'unknown';
}

/** tools (OpenAI) → functions (legacy GigaChat). */
function toGigaFunctions(tools) {
  return (tools || []).map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters
  }));
}

/** messages (OpenAI) → messages (GigaChat). */
function toGigaMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      // GigaChat требует role:'function' и content — валидный JSON.
      const name = m.name || findFnName(messages, m.tool_call_id);
      const raw = typeof m.content === 'string' ? m.content : safeStringify(m.content);
      let content;
      try {
        JSON.parse(raw);
        content = raw;
      } catch (_) {
        content = JSON.stringify(raw);
      }
      return { role: 'function', name, content };
    }

    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const tc = m.tool_calls[0];
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (_) {}
      const out = { role: 'assistant', content: m.content || '', function_call: { name: tc.function?.name, arguments: args } };
      if (m.functions_state_id) out.functions_state_id = m.functions_state_id;
      return out;
    }

    return { role: m.role, content: m.content };
  });
}

/** message (GigaChat) → message (OpenAI). */
function fromGigaMessage(msg) {
  const out = { role: 'assistant', content: msg.content || '' };
  if (msg.function_call) {
    out.tool_calls = [{
      id: msg.function_call.id || `call_${Date.now()}`,
      type: 'function',
      function: {
        name: msg.function_call.name,
        arguments: safeStringify(msg.function_call.arguments)
      }
    }];
  }
  if (msg.functions_state_id) out.functions_state_id = msg.functions_state_id;
  return out;
}

// ==================== Единый вызов ====================

/**
 * Запрос к LLM с (опциональным) function calling.
 * messages — история в формате OpenAI.
 * tools — JSON-схемы инструментов (формат OpenAI).
 * Возвращает объект message (assistant) в формате OpenAI.
 */
export async function chat(messages, tools = null) {
  if (!aiEnabled) throw new Error('ИИ не настроен (нет ключа GigaChat)');
  return chatGigaChat(messages, tools);
}

async function chatGigaChat(messages, tools, retried = false) {
  const token = await getAccessToken(retried);
  const body = {
    model: config.llm.gigachatModel,
    messages: toGigaMessages(messages),
    temperature: 0.2
  };
  if (tools && tools.length) body.functions = toGigaFunctions(tools);

  try {
    const msg = await requestWithRetry(`${config.llm.gigachatBaseUrl}/chat/completions`, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }, body, 'GigaChat');
    return fromGigaMessage(msg);
  } catch (e) {
    // Токен мог истечь раньше времени — один раз пробуем с новым.
    if (!retried && e.needsAuth) {
      log.warn('GigaChat: 401 — обновляю токен и повторяю');
      return chatGigaChat(messages, tools, true);
    }
    throw e;
  }
}

/** POST с ретраями на 429/5xx; помечает 401 флагом needsAuth. */
async function requestWithRetry(url, headers, body, tag) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (res.status === 401 || res.status === 403) {
        const txt = await res.text();
        throw Object.assign(new Error(`${tag} ${res.status}: ${txt.slice(0, 200)}`), { needsAuth: true });
      }
      if (res.status === 429 || res.status >= 500) {
        const txt = await res.text();
        throw Object.assign(new Error(`${tag} ${res.status}: ${txt.slice(0, 200)}`), { retryable: true });
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${tag} ${res.status}: ${txt.slice(0, 200)}`);
      }

      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error(`${tag}: пустой ответ`);
      return msg;
    } catch (e) {
      lastErr = e;
      if (e.retryable && attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        log.warn(`${tag} ретрай через ${delay} мс (${e.message})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

export { aiEnabled, llmProvider };
