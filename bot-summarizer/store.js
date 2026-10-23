// ============================================================
// bot-summarizer — хранение сообщений группы в файле (JSON).
// Данные хранятся ТОЛЬКО за текущий день: при смене даты файл
// очищается автоматически.
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';

// Текущая дата в МСК: YYYY-MM-DD.
function todayMSK() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

let cache = { date: null, messages: [] };

async function load() {
  const date = todayMSK();
  if (cache.date === date) return cache;

  let messages = [];
  try {
    const raw = await readFile(config.dataFile, 'utf8');
    const data = JSON.parse(raw);
    // Если файл за сегодня — берём его, иначе начинаем новый день.
    if (data && data.date === date && Array.isArray(data.messages)) {
      messages = data.messages;
    }
  } catch (_) {
    // Файла нет или он битый — начинаем с пустого.
  }

  cache = { date, messages };
  return cache;
}

async function save() {
  try {
    await mkdir(dirname(config.dataFile), { recursive: true });
    await writeFile(config.dataFile, JSON.stringify(cache), 'utf8');
  } catch (e) {
    log.warn(`Не удалось записать файл сообщений: ${e.message}`);
  }
}

/** Добавить сообщение в хранилище текущего дня. */
export async function addMessage({ id, chatId, from, text, ts }) {
  const store = await load();
  // Не дублируем одно и то же сообщение (по id).
  if (store.messages.some((m) => m.id === id)) return;
  store.messages.push({ id, chatId, from, text, ts });
  await save();
}

/** Получить все сообщения за текущий день. */
export async function getMessages() {
  const store = await load();
  return store.messages;
}

/** Очистить хранилище (например, вручную). */
export async function clear() {
  cache = { date: todayMSK(), messages: [] };
  await save();
}
