// Простой логгер с меткой времени (МСК) и уровнем.
// Без внешних зависимостей — чтобы контейнер был легче.

function ts() {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: process.env.TZ || 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date());
}

function fmt(level, args) {
  return [`[${ts()}] ${level}`, ...args];
}

export const log = {
  info: (...a) => console.log(...fmt('INFO ', a)),
  warn: (...a) => console.warn(...fmt('WARN ', a)),
  error: (...a) => console.error(...fmt('ERROR', a))
};
