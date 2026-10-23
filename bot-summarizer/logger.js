// ============================================================
// bot-summarizer — логгер с меткой времени (МСК).
// ============================================================

function ts() {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(new Date());
}

function out(level, args) {
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log(`[${ts()}] ${level} ${msg}`);
}

export const log = {
  info: (...a) => out('INFO ', a),
  warn: (...a) => out('WARN ', a),
  error: (...a) => out('ERROR', a)
};
