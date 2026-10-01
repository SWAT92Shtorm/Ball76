'use strict';

/* ============================================================
   Ball76 — тестовый хелпер.

   server.js и app.js — монолитные скрипты без экспортов, с побочными
   эффектами на верхнем уровне (подключение к PostgreSQL, app.listen,
   работа с DOM/localStorage). Импортировать их целиком нельзя.

   Этот хелпер читает файл как текст, находит именованную функцию
   и возвращает её как настоящую функцию — чтобы тестировать чистые
   функции без запуска сервера и без подключения к БД.

   Важно: со стороны продакшена ничего не меняется — server.js и app.js
   остаются как есть, хелпер используется только в тестах.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Извлекает функцию `function NAME(...) { ... }` из файла и возвращает её.
 *
 * @param {string} relativeFile путь к файлу относительно корня проекта
 *                              (например, 'server.js' или 'app.js')
 * @param {string} fnName       имя функции
 * @param {Object} [deps]       свободные переменные функции (замыкания),
 *                              например { NAME_REGEX: /.../ } — будут
 *                              подставлены как параметры обёртки.
 * @returns {Function}
 */
function extractFunction(relativeFile, fnName, deps = {}) {
  const filePath = path.resolve(__dirname, '..', '..', relativeFile);
  const source = fs.readFileSync(filePath, 'utf8');

  const marker = `function ${fnName}`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Функция ${fnName} не найдена в ${relativeFile}`);
  }

  const openBrace = source.indexOf('{', start);
  if (openBrace === -1) {
    throw new Error(`Не найдено тело функции ${fnName} в ${relativeFile}`);
  }

  // Считаем баланс фигурных скобок, чтобы найти конец функции.
  // Для целевых чистых функций этого достаточно: в их телах нет
  // несбалансированных скобок в строках/регулярках.
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error(`Не удалось определить конец функции ${fnName} в ${relativeFile}`);
  }

  const code = source.slice(start, end + 1);
  const depNames = Object.keys(deps);
  const depValues = Object.values(deps);
  // function-объявление в скобках становится function-выражением; свободные
  // переменные прокидываем как параметры обёртки.
  const factory = eval(`(function (${depNames.join(', ')}) { return (${code}); })`); // eslint-disable-line no-eval
  return factory(...depValues);
}

/**
 * Извлекает константу `const NAME = <выражение>;` из файла и возвращает её
 * значение. Нужно, например, для NAME_REGEX, от которого зависит
 * извлечённая функция validateFullName.
 *
 * @param {string} relativeFile путь к файлу относительно корня проекта
 * @param {string} constName    имя константы
 * @returns {*}
 */
function extractConst(relativeFile, constName) {
  const filePath = path.resolve(__dirname, '..', '..', relativeFile);
  const source = fs.readFileSync(filePath, 'utf8');

  const marker = `const ${constName} = `;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Константа ${constName} не найдена в ${relativeFile}`);
  }

  // Выражение заканчивается на ';' в конце строки.
  const exprStart = start + marker.length;
  const lineEnd = source.indexOf('\n', exprStart);
  const expr = source.slice(exprStart, lineEnd).trim().replace(/;\s*$/, '');

  return eval(`(${expr})`); // eslint-disable-line no-eval
}

module.exports = { extractFunction, extractConst };
