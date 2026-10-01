'use strict';

/* ============================================================
   Ball76 — юнит-тесты клиентских чистых функций (app.js).

   Тестируется escapeHtml() — экранирование HTML-спецсимволов.
   Критично для безопасности: имена игроков приходят из БД/сети и
   подставляются в innerHTML, поэтому защита от XSS проверяется явно.

   Запуск: node --test (или npm test)
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { extractFunction } = require('./helpers/extract-function');

const escapeHtml = extractFunction('app.js', 'escapeHtml');

// Ожидаемые HTML-сущности собираем в рантайме, чтобы исходник теста
// не зависел от декодирования сущностей инструментами редактирования.
const AMP = String.fromCharCode(38);      // &
const LT = AMP + 'lt;';                   // <
const GT = AMP + 'gt;';                   // >
const AMP_ENT = AMP + 'amp;';             // &
const QUOT = AMP + 'quot;';               // "
const APOS = AMP + '#39;';                // '

test('escapeHtml: экранирует основные HTML-спецсимволы', () => {
  assert.equal(escapeHtml('<'), LT);
  assert.equal(escapeHtml('>'), GT);
  assert.equal(escapeHtml(AMP), AMP_ENT);
  assert.equal(escapeHtml('"'), QUOT);
  assert.equal(escapeHtml(String.fromCharCode(39)), APOS);
});

test('escapeHtml: нейтрализует XSS-пейлоад через тег script', () => {
  const out = escapeHtml('<script>alert(1)</script>');
  assert.equal(out, LT + 'script' + GT + 'alert(1)' + LT + '/script' + GT);
  assert.ok(!out.includes('<script>'));
  assert.ok(!out.includes('</script>'));
});

test('escapeHtml: нейтрализует XSS через атрибут (img onerror)', () => {
  const out = escapeHtml('" onerror="alert(1)');
  assert.ok(!out.includes('"'));
  assert.ok(out.includes(QUOT));
});

test('escapeHtml: амперсанд экранируется первым', () => {
  // Строка "<" должна превратиться в "&lt;", а не в "<lt;".
  assert.equal(escapeHtml(AMP + 'lt;'), AMP_ENT + 'lt;');
  assert.equal(escapeHtml('a ' + AMP + ' b < c'), 'a ' + AMP_ENT + ' b ' + LT + ' c');
});

test('escapeHtml: обычный текст не меняется', () => {
  assert.equal(escapeHtml('Иванов Иван Иванович'), 'Иванов Иван Иванович');
});

test('escapeHtml: пустые/null/undefined значения дают пустую строку', () => {
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml: числа приводятся к строке', () => {
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(42), '42');
});

test('escapeHtml: результат не содержит "сырых" опасных символов', () => {
  const out = escapeHtml('<img src=x onerror="alert(1)">');
  // В выводе не должно быть открывающих/закрывающих угловых скобок
  // или двойных кавычек — все они уходят в сущности.
  assert.ok(!out.includes('<'));
  assert.ok(!out.includes('>'));
  assert.ok(!out.includes('"'));
  assert.ok(out.includes(LT + 'img'));
});

test('escapeHtml: апостроф не ломает строку в JS-контексте', () => {
  const out = escapeHtml("O'Neil");
  assert.ok(!out.includes(String.fromCharCode(39)));
  assert.ok(out.includes(APOS));
});

// --- dayNameFromCode: обратное преобразование кода дня в имя ---
// Нужно для дней без слотов расписания (например, игра вне графика):
// showSchedule() берёт имя дня по коду, когда slots пуст.

const dayNameFromCode = extractFunction('app.js', 'dayNameFromCode');

test('dayNameFromCode: 1..7 → английские имена дней', () => {
  assert.equal(dayNameFromCode(1), 'Monday');
  assert.equal(dayNameFromCode(2), 'Tuesday');
  assert.equal(dayNameFromCode(3), 'Wednesday');
  assert.equal(dayNameFromCode(4), 'Thursday');
  assert.equal(dayNameFromCode(5), 'Friday');
  assert.equal(dayNameFromCode(6), 'Saturday');
  assert.equal(dayNameFromCode(7), 'Sunday');
});

test('dayNameFromCode: некорректный код даёт пустую строку', () => {
  assert.equal(dayNameFromCode(0), '');
  assert.equal(dayNameFromCode(8), '');
  assert.equal(dayNameFromCode(null), '');
  assert.equal(dayNameFromCode(undefined), '');
});
