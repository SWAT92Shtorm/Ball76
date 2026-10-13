'use strict';

/* ============================================================
   Ball76 — юнит-тесты серверных чистых функций (server.js).

   Тестируются:
     - validateFullName() — серверная валидация ФИО;
     - formatDateMSK()    — форматирование даты в московском времени.

   Запуск (без зависимостей, встроенный тестраннер Node):
     node --test
     node --test test/
     npm test
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { extractFunction, extractConst } = require('./helpers/extract-function');

// validateFullName использует NAME_REGEX из того же файла — извлекаем его
// отдельно, чтобы тест проверял настоящую регулярку, а не её копию.
const NAME_REGEX = extractConst('server.js', 'NAME_REGEX');
const validateFullName = extractFunction('server.js', 'validateFullName', { NAME_REGEX });
const formatDateMSK = extractFunction('server.js', 'formatDateMSK');
const normalizeScoreValue = extractFunction('server.js', 'normalizeScoreValue');
const normalizePair = extractFunction('server.js', 'normalizePair');

test('validateFullName: корректные ФИО из 3–5 слов', () => {
  assert.equal(validateFullName('Иванов Иван Иванович'), null);
  assert.equal(validateFullName('Иванов Иван Иванович Петрович'), null);
  assert.equal(validateFullName('Иванов Иван Иванович Петрович Сергеевич'), null);
});

test('validateFullName: допускает дефис и апостроф внутри слова', () => {
  assert.equal(validateFullName('Иванов-Петров Иван Иванович'), null);
  assert.equal(validateFullName("О'Нил Майкл Джордан"), null);
});

test('validateFullName: допускает латиницу', () => {
  assert.equal(validateFullName('Ivanov Ivan Ivanovich'), null);
});

test('validateFullName: срезает пробелы по краям', () => {
  assert.equal(validateFullName('   Иванов Иван Иванович   '), null);
});

test('validateFullName: отвергает не-строку', () => {
  assert.equal(validateFullName(123), 'ФИО должно быть строкой');
  assert.equal(validateFullName(null), 'ФИО должно быть строкой');
  assert.equal(validateFullName(undefined), 'ФИО должно быть строкой');
  assert.equal(validateFullName({}), 'ФИО должно быть строкой');
});

test('validateFullName: отвергает пустую строку и пробелы', () => {
  assert.equal(validateFullName(''), 'ФИО не может быть пустым');
  assert.equal(validateFullName('     '), 'ФИО не может быть пустым');
});

test('validateFullName: отвергает слишком длинное ФИО (> 80 символов)', () => {
  const long = 'Иванов '.repeat(12) + 'Иван'; // заметно больше 80 символов
  assert.match(validateFullName(long), /слишком длинное/);
});

test('validateFullName: отвергает менее 3 слов', () => {
  assert.ok(validateFullName('Иванов') !== null);
  assert.ok(validateFullName('Иванов Иван') !== null);
});

test('validateFullName: отвергает более 5 слов', () => {
  assert.ok(validateFullName('Иванов Иван Иванович Петрович Сергеевич Дмитриевич') !== null);
});

test('validateFullName: отвергает цифры и спецсимволы', () => {
  assert.ok(validateFullName('Иванов Иван 123') !== null);
  assert.ok(validateFullName('Иванов Иван Иванович; DROP TABLE players') !== null);
  assert.ok(validateFullName('<script> Иванов Иван</script>') !== null);
});

test('validateFullName: отвергает ФИО, начинающееся с дефиса/апострофа', () => {
  assert.ok(validateFullName('-ванов Иван Иванович') !== null);
  assert.ok(validateFullName("'ванов Иван Иванович") !== null);
});

test('formatDateMSK: формат YYYY-MM-DD', () => {
  assert.equal(formatDateMSK(new Date('2026-08-25T12:00:00Z')), '2026-08-25');
});

test('formatDateMSK: корректно переводит UTC в МСК (UTC+3)', () => {
  // 22:00 UTC 25 августа → 01:00 МСК 26 августа
  assert.equal(formatDateMSK(new Date('2026-08-25T22:00:00Z')), '2026-08-26');
  // 20:59:59 UTC 25 августа → 23:59:59 МСК 25 августа
  assert.equal(formatDateMSK(new Date('2026-08-25T20:59:59Z')), '2026-08-25');
  // 21:00 UTC 25 августа → 00:00 МСК 26 августа (граница суток)
  assert.equal(formatDateMSK(new Date('2026-08-25T21:00:00Z')), '2026-08-26');
});

test('formatDateMSK: корректно на границе года', () => {
  // 23:30 UTC 31 декабря → 02:30 МСК 1 января
  assert.equal(formatDateMSK(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
});

test('normalizeScoreValue: корректные значения счёта', () => {
  assert.equal(normalizeScoreValue(0), 0);
  assert.equal(normalizeScoreValue(2), 2);
  assert.equal(normalizeScoreValue(3), 3);
  assert.equal(normalizeScoreValue(999), 999);
});

test('normalizeScoreValue: строки-числа приводятся к целому', () => {
  assert.equal(normalizeScoreValue('5'), 5);
  assert.equal(normalizeScoreValue('0'), 0);
});

test('normalizeScoreValue: дробные обрезаются до целого', () => {
  assert.equal(normalizeScoreValue(2.9), 2);
  assert.equal(normalizeScoreValue(-1.5), null); // отрицательное после trunc — отвергается
});

test('normalizeScoreValue: отрицательные значения отвергаются', () => {
  assert.equal(normalizeScoreValue(-1), null);
  assert.equal(normalizeScoreValue(-100), null);
});

test('normalizeScoreValue: слишком большие значения отвергаются', () => {
  assert.equal(normalizeScoreValue(1000), null);
  assert.equal(normalizeScoreValue(1e9), null);
});

test('normalizeScoreValue: нечисловые значения отвергаются', () => {
  assert.equal(normalizeScoreValue('abc'), null);
  assert.equal(normalizeScoreValue(NaN), null);
  assert.equal(normalizeScoreValue(Infinity), null);
  assert.equal(normalizeScoreValue(null), null);
  assert.equal(normalizeScoreValue(undefined), null);
  assert.equal(normalizeScoreValue({}), null);
});

test('normalizePair: допустимые пары команд', () => {
  assert.equal(normalizePair('1-2'), '1-2');
  assert.equal(normalizePair('1-3'), '1-3');
  assert.equal(normalizePair('2-3'), '2-3');
});

test('normalizePair: недопустимые пары отвергаются', () => {
  assert.equal(normalizePair('2-1'), null);   // только по возрастанию
  assert.equal(normalizePair('3-4'), null);
  assert.equal(normalizePair('1'), null);
  assert.equal(normalizePair('1-2-3'), null);
  assert.equal(normalizePair(''), null);
  assert.equal(normalizePair(null), null);
  assert.equal(normalizePair(undefined), null);
  assert.equal(normalizePair(12), null);
});
