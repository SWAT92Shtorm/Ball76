// ============================================================
// bot-summarizer — клиент GigaChat (Sber) для пересказа.
// Простой чат без function calling: отправляем сообщения группы
// и получаем краткий пересказ.
// ============================================================

import { config, aiEnabled } from './config.js';
import { log } from './logger.js';

const RETRY_DELAYS = [1000, 3000]; // при 429 / 5xx

let tokenCache = { value: null, exp: 0 };
let tokenPromise = null;

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

/**
 * Запросить пересказ у GigaChat.
 * @param {string} systemPrompt  системный промпт
 * @param {string} userText     текст (сообщения группы)
 * @returns {Promise<string>}   ответ модели
 */
export async function summarize(systemPrompt, userText) {
  if (!aiEnabled) throw new Error('ИИ не настроен (нет ключа GigaChat)');
  return chatGigaChat(systemPrompt, userText, false);
}

async function chatGigaChat(systemPrompt, userText, retried) {
  const token = await getAccessToken(retried);
  const body = {
    model: config.llm.gigachatModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ],
    temperature: 0.3
  };

  try {
    const msg = await requestWithRetry(`${config.llm.gigachatBaseUrl}/chat/completions`, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }, body, 'GigaChat');
    return msg.content || '';
  } catch (e) {
    if (!retried && e.needsAuth) {
      log.warn('GigaChat: 401 — обновляю токен и повторяю');
      return chatGigaChat(systemPrompt, userText, true);
    }
    throw e;
  }
}

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
