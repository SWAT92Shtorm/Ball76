// ============================================================
// LLM-клиент (Groq, OpenAI-совместимый).
// Реализован на fetch без SDK — минимум зависимостей.
// ============================================================

import { config, aiEnabled } from './config.js';
import { log } from './logger.js';

const RETRY_DELAYS = [1000, 3000]; // при 429 / 5xx

/**
 * Запрос к chat/completions с function calling.
 * messages — история в формате OpenAI.
 * tools — JSON-схемы инструментов.
 * Возвращает объект message (assistant) из ответа.
 */
export async function chat(messages, tools = null) {
  if (!aiEnabled) throw new Error('ИИ не настроен (нет LLM_API_KEY)');

  const body = {
    model: config.llm.model,
    messages,
    temperature: 0.2
  };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.llm.apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (res.status === 429 || res.status >= 500) {
        const txt = await res.text();
        throw Object.assign(new Error(`LLM ${res.status}: ${txt.slice(0, 200)}`), { retryable: true });
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`LLM ${res.status}: ${txt.slice(0, 200)}`);
      }

      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error('LLM: пустой ответ');
      return msg;
    } catch (e) {
      lastErr = e;
      if (e.retryable && attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        log.warn(`LLM ретрай через ${delay} мс (${e.message})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

export { aiEnabled };
