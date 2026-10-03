/* ============================================================
   Ball76 — клиентская логика
   Модули: config → utils → state → api → schedule → ui → teams → init
   Конфиг (цены, телефоны, расписание, лимиты) приходит с сервера
   через GET /api/config — дублировать его здесь не нужно.
   ============================================================ */

'use strict';

// ==================== 1. CONFIG ====================

// Базовый URL API: динамически по hostname, чтобы один файл работал
// и на GitHub Pages (продакшен), и через туннель, и локально.
//
// Приоритет:
//  1. localStorage['ball76_api']  — адрес, сохранённый при входе через туннель
//     (или заданный вручную); переживает перезагрузку страницы.
//  2. Туннельный домен в address bar (.loca.lt) — API живёт на том же хосте,
//     что и страница.
//  3. GitHub Pages — продакшен на Railway.
//  4. Остальное (localhost, IP, file://) — локальный Docker.
// Резервные адреса туннелей (loca.lt): три поддомена, чтобы при отвале одного
// можно было переключиться на другой. Запускаются скриптом ./tunnel.sh.
// Список обновляется из конфига сервера (APP_CONFIG.tunnels) после loadConfig().
let KNOWN_TUNNELS = [
  'https://ball76api-1.loca.lt',
  'https://ball76api-2.loca.lt',
  'https://ball76api-3.loca.lt'
];
// Дефолтный адрес туннеля (первый из списка).
const DEFAULT_TUNNEL_URL = KNOWN_TUNNELS[0];

// Сохранить адрес API в localStorage (переживает перезагрузку страницы).
function saveApiUrl(url) {
  try { localStorage.setItem('ball76_api', url); } catch (_) {}
}

// Проверка живости API по адресу: GET /api/status с заголовком bypass для loca.lt.
async function probeTunnel(url, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const isLocaLt = /\.loca\.lt$/.test(url);
    const resp = await fetch(`${url}/api/status`, {
      headers: isLocaLt ? { 'bypass-tunnel-reminder': '1' } : {},
      signal: ctrl.signal
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return true;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// Переключение на резервный туннель: пробуем остальные известные адреса
// (в порядке списка, начиная со следующего после текущего). При успехе —
// сохраняем новый адрес и перезагружаем страницу. Возвращает true, если
// переключение произошло (страница перезагружается), false — если ни один
// резервный не ответил.
let _failoverInProgress = false;
async function failoverToNextTunnel(currentUrl, reason) {
  if (_failoverInProgress) return false;
  if (!/\.loca\.lt$/.test(currentUrl)) return false; // только для loca.lt
  _failoverInProgress = true;
  showToast(`⚠️ ${reason}. Пробуем резервный туннель…`, 'info');
  const idx = KNOWN_TUNNELS.indexOf(currentUrl);
  for (let i = 1; i < KNOWN_TUNNELS.length; i++) {
    const candidate = KNOWN_TUNNELS[(idx + i) % KNOWN_TUNNELS.length];
    if (candidate === currentUrl) continue;
    if (await probeTunnel(candidate)) {
      saveApiUrl(candidate);
      location.reload();
      return true;
    }
  }
  _failoverInProgress = false;
  return false;
}

// Валидация URL: должен начинаться с http(s):// и содержать домен с точкой
// или быть localhost/IP. Отсекает мусор вроде "123123".
function isValidApiUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // localhost / IP — валидно
    if (u.hostname === 'localhost' || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(u.hostname)) return true;
    // Домен с точкой (например ball76api.loca.lt)
    return u.hostname.includes('.');
  } catch (_) {
    return false;
  }
}

function detectApiBase() {
  const host = location.hostname;

  // Локальная разработка — API в Docker на localhost:8080.
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:8080';
  }

  // Легаси-режим GitHub Pages: сохранённый туннель или дефолтный.
  if (host === 'swat92shtorm.github.io') {
    let saved = null;
    try { saved = localStorage.getItem('ball76_api'); } catch (_) {}
    if (saved && isValidApiUrl(saved)) return saved.replace(/\/+$/, '');
    return DEFAULT_TUNNEL_URL;
  }

  // Продакшен (домен/IP CloudCore): страница и API живут на одном origin —
  // nginx отдаёт статику и проксирует /api/ на Node-контейнер.
  // localStorage здесь игнорируем: старые адреса туннелей loca.lt не должны
  // ломать боевой сайт (это была причина «Fetch is aborted»).
  try { localStorage.removeItem('ball76_api'); } catch (_) {}
  return location.origin;
}

let API_BASE_URL = detectApiBase();

// Заголовки для bypass'а tunnel-reminder от loca.lt:
// без них loca.lt показывает страницу-подтверждение (ввести IP хоста),
// и все fetch-запросы получают HTML вместо JSON.
// Функция (не константа) — потому что API_BASE_URL может смениться
// в loadConfig() при фолбэке на DEFAULT_TUNNEL_URL.
function getTunnelHeaders() {
  return /\.loca\.lt$/.test(API_BASE_URL)
    ? { 'bypass-tunnel-reminder': '1' }
    : {};
}

// Конфиг приходит ТОЛЬКО с сервера. Без заглушки: если API недоступен —
// страница честно показывает ошибку, а не имитирует работу.
let CONFIG = null;

async function loadConfig() {
  if (!API_BASE_URL) {
    openTunnelModal('Адрес API не задан. Введите адрес туннеля:');
    return false;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const response = await fetch(`${API_BASE_URL}/api/config`, { headers: getTunnelHeaders(), signal: ctrl.signal });
    clearTimeout(t);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    CONFIG = await response.json();
    // Если сервер прислал список туннелей — обновляем локальный список
    // (единый источник правды в APP_CONFIG).
    if (Array.isArray(CONFIG.tunnels) && CONFIG.tunnels.length > 0) {
      KNOWN_TUNNELS = [...CONFIG.tunnels];
    }
    return true;
  } catch (err) {
    // Туннельный/локальный режим — пробуем резервные адреса и показываем модалку.
    // Боевой домен (один origin) — просто сообщаем об ошибке, без loca.lt-модалки.
    const isTunnelMode = /\.loca\.lt$|localhost|127\.0\.0\.1/.test(API_BASE_URL)
      || location.hostname === 'swat92shtorm.github.io';
    if (isTunnelMode) {
      try { localStorage.removeItem('ball76_api'); } catch (_) {}

      // Пробуем остальные известные туннели (в порядке списка, начиная со
      // следующего после текущего). При успехе — сохраняем и перезагружаем.
      const idx = KNOWN_TUNNELS.indexOf(API_BASE_URL);
      for (let i = 1; i < KNOWN_TUNNELS.length; i++) {
        const candidate = KNOWN_TUNNELS[(idx + i) % KNOWN_TUNNELS.length];
        if (candidate === API_BASE_URL) continue;
        try {
          const ctrl2 = new AbortController();
          const t2 = setTimeout(() => ctrl2.abort(), 5000);
          const resp2 = await fetch(`${candidate}/api/config`, {
            headers: { 'bypass-tunnel-reminder': '1' },
            signal: ctrl2.signal
          });
          clearTimeout(t2);
          if (resp2.ok) {
            CONFIG = await resp2.json();
            // Обновляем список туннелей из конфига (единый источник правды).
            if (Array.isArray(CONFIG.tunnels) && CONFIG.tunnels.length > 0) {
              KNOWN_TUNNELS = [...CONFIG.tunnels];
            }
            API_BASE_URL = candidate;
            saveApiUrl(candidate);
            showToast(`Переключились на резервный туннель: ${candidate}`, 'info');
            return true;
          }
        } catch (_) { /* этот туннель не работает — пробуем следующий */ }
      }

      openTunnelModal(`⚠️ API (${API_BASE_URL}) недоступен: ${err.message}. Выберите рабочий адрес:`);
    } else {
      showApiError(`API (${API_BASE_URL}) недоступен: ${err.message}`);
    }
    return false;
  }
}

let _tunnelModalEl = null;

function openTunnelModal(message) {
  closeTunnelModal();
  const main = document.querySelector('main');
  if (!main) return;
  const div = document.createElement('div');
  div.className = 'tunnel-modal';
  div.innerHTML = `
    <div class="tunnel-modal-box">
      <div class="tunnel-modal-icon">🔌</div>
      <h3 class="tunnel-modal-title">Нет соединения с сервером</h3>
      <p class="tunnel-modal-text" id="tunnelModalMsg">${message}</p>
      <div class="tunnel-modal-row">
        <select id="tunnelUrlSelect" class="tunnel-modal-input tunnel-modal-select">
          ${KNOWN_TUNNELS.map(u => `<option value="${u}">${u}</option>`).join('\n          ')}
        </select>
        <button id="tunnelModalBtn" class="tunnel-modal-btn">Подключить</button>
      </div>
      <p class="tunnel-modal-hint">Туннели запускает команда <code>./tunnel.sh</code>. Выберите рабочий адрес.</p>
    </div>`;
  main.prepend(div);
  _tunnelModalEl = div;
  // Предвыбираем текущий адрес, если он в списке
  const sel = document.getElementById('tunnelUrlSelect');
  if (sel && KNOWN_TUNNELS.includes(API_BASE_URL)) sel.value = API_BASE_URL;
  setTimeout(() => sel?.focus(), 100);
  sel.addEventListener('change', () => { setTunnelModalError(''); });
  document.getElementById('tunnelModalBtn').addEventListener('click', connectTunnel);
}

function closeTunnelModal() {
  if (_tunnelModalEl) { _tunnelModalEl.remove(); _tunnelModalEl = null; }
}

function setTunnelModalError(msg) {
  const el = document.getElementById('tunnelModalMsg');
  if (!el) return;
  if (!msg) { el.textContent = ''; el.style.color = ''; return; }
  el.textContent = msg;
  el.style.color = '#e74c3c';
}

async function connectTunnel() {
  const sel = document.getElementById('tunnelUrlSelect');
  const url = (sel?.value || '').trim().replace(/\/+$/, '');
  if (!url) { setTunnelModalError('Выберите адрес туннеля'); return; }
  // Базовая валидация
  try { new URL(url); } catch { setTunnelModalError('Некорректный URL. Пример: https://ball76api-1.loca.lt'); return; }

  const btn = document.getElementById('tunnelModalBtn');
  btn.disabled = true;
  btn.textContent = 'Проверка…';

  // Проверяем что API отвечает ПЕРЕД сохранением
  if (await probeTunnel(url)) {
    // Успех — сохраняем и перезагружаем
    saveApiUrl(url);
    location.reload();
  } else {
    // Ошибка — показываем в модалке, НЕ перезагружаем
    setTunnelModalError(`⚠️ ${url} не отвечает. Выберите другой адрес из списка.`);
    btn.disabled = false;
    btn.textContent = 'Подключить';
  }
}

function showApiError(message) {
  const main = document.querySelector('main');
  if (!main) return;
  const div = document.createElement('div');
  div.className = 'db-warning-banner';
  div.style.display = 'block';
  div.textContent = '⚠️ ' + message;
  main.prepend(div);
  // Блокируем все кнопки записи
  document.querySelectorAll('button').forEach(btn => {
    if (btn.onclick && btn.onclick.toString().includes('addPlayer')) {
      btn.disabled = true;
    }
  });
}

// Удобные доступы к конфигу зала (безопасны при CONFIG = null)
function hallName(hallId)      { return CONFIG?.halls?.[hallId]?.name || hallId; }
function hallPhone(hallId)     { return CONFIG?.halls?.[hallId]?.phone || ''; }
function hallResp(hallId)      { return CONFIG?.halls?.[hallId]?.responsible || ''; }
function hallPrice(hallId, durationKey) {
  return CONFIG?.halls?.[hallId]?.prices?.[durationKey] ?? 0;
}
function hallSchedule(hallId)  { return CONFIG?.halls?.[hallId]?.schedule || []; }
function maxPlayers()          { return CONFIG?.maxPlayers || 18; }

// Обычное время начала игры зала (первый слот расписания) в формате HH:MM.
// Используется как значение по умолчанию для дополнительной игры.
function getDefaultStartTime(hallId) {
  const slot = hallSchedule(hallId)[0];
  return slot ? `${String(slot.from).padStart(2, '0')}:00` : '';
}

// ==================== 2. UTILS ====================

// Экранирование HTML-спецсимволов: имена игроков приходят из БД/сети
// и подставляются в innerHTML — без экранирования это XSS.
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Открыть чат с пользователем Telegram: сначала пытаемся открыть само
// приложение (deep-link tg://), а если оно не установлено — через 1.2 c
// откатываемся на веб-версию t.me. Возвращает false, чтобы отменить
// переход по href (иначе браузер уйдёт на tg:// без отката).
function openTelegram(uname) {
  const web = `https://t.me/${uname}`;
  let timer = setTimeout(() => { window.location.href = web; }, 1200);
  const cancel = () => clearTimeout(timer);
  // Если приложение открылось — вкладка уходит в фон: отменяем откат.
  window.addEventListener('blur', cancel, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancel();
  }, { once: true });
  window.location.href = `tg://resolve?domain=${uname}`;
  return false;
}

// HTML-ссылка на профиль Telegram игрока (по ФИО) или пустая строка.
// Имя приходит из БД и экранируется; username дополнительно санируется,
// чтобы в href не попали посторонние символы (защита от инъекции).
function telegramLinkHtml(name) {
  const link = telegramLinks[name] || telegramLinks[String(name || '').trim()];
  if (!link || !link.username) return '';
  const uname = String(link.username).trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{3,64}$/.test(uname)) return '';
  const safeUname = encodeURIComponent(uname);
  return `<a class="tg-link" href="tg://resolve?domain=${safeUname}"`
    + ` onclick="return openTelegram('${uname}')"`
    + ` title="Написать в Telegram: @${escapeHtml(uname)}">`
    + `<svg class="tg-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">`
    + `<path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>`
    + `@${escapeHtml(uname)}</a>`;
}

// Тосты (уведомления)
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

// Копировать телефон в буфер + открыть Сбербанк (СБП) на мобильных
async function copyPhoneToClipboard(phone) {
  // Форматируем номер для tel:/deep-link: +79611544411
  const digits = phone.replace(/[^\d+]/g, '');
  const telFormat = digits.startsWith('+') ? digits : '+7' + digits.replace(/^8/, '');

  try {
    await navigator.clipboard.writeText(phone);
    showToast('Телефон скопирован', 'success', 2000);
  } catch (err) {
    console.error('Не удалось скопировать телефон:', err);
    showToast('Не удалось скопировать телефон', 'error');
  }

  // На мобильных открываем Сбербанк через deep link (СБП-перевод)
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    setTimeout(() => {
      window.location.href = 'sberbank://pay?account=' + encodeURIComponent(telFormat);
    }, 500); // даём тосту показаться перед переходом
  }
}

// Текущая дата/день недели в московском времени (игры проходят по МСК).
// ВАЖНО: нельзя использовать локальное время браузера — если пользователь
// откроет страницу из другого часового пояса, «ближайшая игра» сдвинется.
function getMSKNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const get = type => parts.find(p => p.type === type).value;
  const d = new Date();
  d.setFullYear(+get('year'), +get('month') - 1, +get('day'));
  d.setHours(+get('hour') % 24, +get('minute'), +get('second'), 0);
  return d;
}

// Сегодняшняя дата 'YYYY-MM-DD' по московскому времени (для min у date input).
function mskToday() {
  const now = getMSKNow();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Fisher–Yates shuffle (в отличие от sort(() => Math.random() - 0.5)
// даёт равномерное перемешивание)
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ==================== 3. STATE ====================

let playersByHall = { hall1: [], hall2: [] };
let playerNames = [];
let historyByDate = {};
// Карта «ФИО → аккаунт Telegram» (из таблицы telegram_links).
// Используется, чтобы рядом с именем игрока показать кликабельную ссылку.
let telegramLinks = {};
let lastHallDateKey = null;   // «зал|дата» — ключ для перезагрузки при смене зала/даты
let isInitialLoad = true;
let editingIndex = null;        // индекс строки, открытой на редактирование (UX1)
let apiOnline = true;           // статус соединения с API (UX2)
let dbOnline = true;            // статус соединения сервера с БД

// ==================== 4. API ====================

// Баннер «сервер недоступен»: показываем, когда API не отвечает,
// и НЕ очищаем последний успешный список — иначе пользователь
// подумает, что никто не записался, и задвоит запись.
function setApiStatus(online) {
  if (online === apiOnline) return;
  apiOnline = online;
  let banner = document.getElementById('apiErrorBanner');
  if (!online) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'apiErrorBanner';
      banner.className = 'api-error-banner';
      document.querySelector('main').prepend(banner);
    }
    banner.textContent = '⚠️ Не удалось подключиться к серверу. Показаны последние известные данные.';
    banner.style.display = 'block';
  } else if (banner) {
    banner.style.display = 'none';
  }
}

// Проверка соединения сервера с БД через GET /api/status.
// Если БД недоступна — показываем предупреждение о невозможности записи
// и блокируем кнопку «Записаться» (запись всё равно не пройдёт на сервере).
async function checkDbStatus() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/status`, { headers: getTunnelHeaders() });
    const data = await response.json();
    const online = !!data.db && response.ok;
    if (online !== dbOnline) {
      dbOnline = online;
      updateDbWarning();
    }
  } catch (err) {
    // Сервер не ответил вообще. Если адрес — loca.lt туннель, пробуем
    // переключиться на резервный (туннель мог отвалиться).
    if (/\.loca\.lt$/.test(API_BASE_URL)) {
      const switched = await failoverToNextTunnel(API_BASE_URL, 'Туннель не отвечает');
      if (switched) return; // страница перезагружается
    }
    // Резервные не помогли (или адрес не loca.lt) — считаем БД недоступной
    if (dbOnline) {
      dbOnline = false;
      updateDbWarning();
    }
  }
}

function updateDbWarning() {
  let warning = document.getElementById('dbWarning');
  const btn = document.querySelector('button[onclick="addPlayer()"]');
  if (!dbOnline) {
    if (!warning) {
      warning = document.createElement('div');
      warning.id = 'dbWarning';
      warning.className = 'db-warning-banner';
      const main = document.querySelector('main');
      main.prepend(warning);
    }
    warning.textContent = '⚠️ Запись на баскетбол пока невозможна: нет соединения с базой данных. Попробуйте позже.';
    warning.style.display = 'block';
    if (btn) {
      btn.disabled = true;
      btn.title = 'Нет соединения с базой данных';
    }
  } else {
    if (warning) warning.style.display = 'none';
    // Кнопку вернёт validatePlayerName() при следующем вводе/проверке
    if (btn) {
      validatePlayerName();
    }
  }
}

async function loadFromAPI({ silent = false, refreshHall = true } = {}) {
  // UX1: если открыт инпут редактирования — не перерисовываем список,
  // чтобы не сжечь введённое имя
  if (editingIndex !== null && !silent) {
    return;
  }

  const currentHall = document.getElementById('hallSelect').value;

  try {
    // 1. Игроки текущей игры выбранного зала.
    // refreshHall=false — при переключении залов: данные этого зала уже
    // есть в кэше playersByHall (загружали при первом открытии), а повторный
    // запрос на время загрузки показывал бы пустой список → «зелёное»
    // мигание блока стоимости. Перерисуемся из кэша, фоновое обновление
    // подтянет свежие данные через 30 секунд.
    let playersData;
    if (refreshHall) {
      const dateStr = getNearestGameDate(currentHall);
      const response = await fetch(
        `${API_BASE_URL}/api/players/${currentHall}/${dateStr}`,
        { headers: getTunnelHeaders() }
      );
      if (!response.ok) throw new Error('Не удалось загрузить участников');
      playersData = await response.json();
    } else {
      playersData = { playersByHall };
    }
    playersByHall = playersData.playersByHall || { hall1: [], hall2: [] };

    // 2. История записей из базы (все игры)
    const historyResponse = await fetch(`${API_BASE_URL}/api/history`, { headers: getTunnelHeaders() });
    if (!historyResponse.ok) throw new Error('Не удалось загрузить историю');
    const historyData = await historyResponse.json();
    historyByDate = historyData.historyByDate || {};

    // 2b. Связки с Telegram (ФИО → @username) — не критично для работы,
    // поэтому при ошибке/отсутствии таблицы просто оставляем пустую карту.
    try {
      const linksResponse = await fetch(`${API_BASE_URL}/api/telegram-links`, { headers: getTunnelHeaders() });
      if (linksResponse.ok) {
        const linksData = await linksResponse.json();
        telegramLinks = linksData.links || {};
      }
    } catch (_) { /* нет связок — не критично */ }

    // Пересчёт счётчика визитов для текущего зала (O(M) вместо O(N×M) на рендер)
    rebuildVisitCounts(currentHall);

    // 3. Собрать playerNames из базы (текущие игроки + история)
    const allNames = new Set();
    Object.values(playersByHall).forEach(hallPlayers => {
      hallPlayers.forEach(name => { if (name) allNames.add(name); });
    });
    Object.keys(historyByDate).forEach(dateStr => {
      const dateData = historyByDate[dateStr];
      for (const hallId in dateData) {
        (dateData[hallId]?.players || []).forEach(name => {
          if (name) allNames.add(name.trim());
        });
      }
    });
    playerNames = Array.from(allNames);

    setApiStatus(true);
  } catch (err) {
    console.error('Ошибка при запросе API:', err);
    // Туннель мог отвалиться — пробуем переключиться на резервный.
    if (/\.loca\.lt$/.test(API_BASE_URL)) {
      const switched = await failoverToNextTunnel(API_BASE_URL, 'Туннель не отвечает');
      if (switched) return; // страница перезагружается
    }
    // UX2: НЕ сбрасываем данные — держим последний успешный снимок
    setApiStatus(false);
    return;
  }

  // Дропдаун подсказок не нужно перерисовывать: он читает playerNames
  // и historyByDate на лету (в filterAutocomplete), а их мы только что обновили.
  showList();
}

// Добавить игрока
async function addPlayer() {
  const input = document.getElementById('playerName');
  const error = document.getElementById('playerNameError');
  const name = input.value.trim();
  const words = name.split(/\s+/).filter(w => w.length > 0);

  // Правило совпадает с серверным (validateFullName): 3–5 слов
  if (!name || words.length < 3 || words.length > 5) {
    validatePlayerName();
    return;
  }

  const hall = document.getElementById('hallSelect').value;
  if (!hall) {
    showToast('Сначала выберите зал', 'error');
    return;
  }

  // Если нет соединения с БД — запись невозможна
  if (!dbOnline) {
    showToast('Запись на баскетбол пока невозможна: нет соединения с базой данных', 'error');
    return;
  }

  const dateStr = getNearestGameDate(hall);
  if (!dateStr) {
    showToast('Не удалось определить ближайшую дату игры', 'error');
    return;
  }

  // Блокируем кнопку на время запроса
  const btn = document.querySelector('button[onclick="addPlayer()"]');
  const originalBtnText = btn.textContent;
  btn.dataset.loading = '1';
  btn.disabled = true;
  btn.textContent = 'Запись...';

  try {
    const response = await fetch(`${API_BASE_URL}/api/players/${hall}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTunnelHeaders() },
      body: JSON.stringify({ name, date: dateStr })
    });

    if (!response.ok) {
      let serverError = 'Ошибка при добавлении игрока';
      try {
        const errData = await response.json();
        if (errData.error) serverError = errData.error;
      } catch (_) {}
      throw new Error(serverError);
    }

    // Анимация успеха
    const anim = document.getElementById('successAnimation');
    anim.style.display = 'block';
    anim.innerHTML = `
      <div class="success-anim-row">
        <div class="smile">🏀</div>
        <div class="smile">⛹🏻‍♂️</div>
        <div class="smile">👍</div>
      </div>
    `;
    setTimeout(() => { anim.style.display = 'none'; }, 3000);

    const result = await response.json();
    playersByHall = result.playersByHall || playersByHall;

    if (!playerNames.includes(name)) {
      playerNames.push(name);
    }

    // Сохраняем ФИО в localStorage для автоподстановки при следующем визите
    try { localStorage.setItem('ball76_lastName', name); } catch (_) {}

    input.value = '';
    hideAutocomplete();
    resetInputStyles(input, error);
    showList();

    await loadFromAPI();
    const _hall = document.getElementById('hallSelect').value;
    if (_hall) { await loadSignupStats(_hall); showSchedule(); }
    showToast(`${name} записан на игру`, 'success');
  } catch (err) {
    console.error('Ошибка при добавлении через API:', err);
    // Туннель мог отвалиться — пробуем переключиться на резервный.
    if (/\.loca\.lt$/.test(API_BASE_URL)) {
      const switched = await failoverToNextTunnel(API_BASE_URL, 'Туннель не отвечает');
      if (switched) return; // страница перезагружается
    }
    showToast(err.message || 'Не удалось добавить игрока', 'error');
  } finally {
    btn.dataset.loading = '0';
    btn.textContent = originalBtnText;
    validatePlayerName(); // пересчитает disabled по текущему содержимому поля
  }
}

// ==== Модалка подтверждения удаления (UX3) ====
let deleteModalIndex = null;

function openDeleteModal(index) {
  const hall = document.getElementById('hallSelect').value;
  const name = playersByHall[hall][index];
  deleteModalIndex = index;
  document.getElementById('deleteModalName').textContent = name;
  document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
  deleteModalIndex = null;
  document.getElementById('deleteModal').style.display = 'none';
}

// Удалить участника (вызывается кнопкой «Удалить» в модалке)
async function confirmRemovePlayer() {
  const index = deleteModalIndex;
  closeDeleteModal();
  if (index === null) return;
  await doRemovePlayer(index);
}

async function doRemovePlayer(index) {
  const hall = document.getElementById('hallSelect').value;
  const name = playersByHall[hall][index];

  const dateStr = getNearestGameDate(hall);
  if (!dateStr) {
    showToast('Не удалось определить ближайшую дату игры', 'error');
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/players/${hall}/${dateStr}/${encodeURIComponent(name)}`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...getTunnelHeaders() } }
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Ошибка при удалении игрока');
    }

    const result = await response.json();
    playersByHall[hall] = result.playerNames || [];

    const idxInNames = playerNames.indexOf(name);
    if (idxInNames !== -1) {
      playerNames.splice(idxInNames, 1);
    }

    await loadFromAPI();
    showList();
    const _hall2 = document.getElementById('hallSelect').value;
    if (_hall2) { await loadSignupStats(_hall2); showSchedule(); }
    showToast(`«${name}» удалён из списка`, 'success');
  } catch (err) {
    console.error('Ошибка при удалении через API:', err);
    // Туннель мог отвалиться — пробуем переключиться на резервный.
    if (/\.loca\.lt$/.test(API_BASE_URL)) {
      const switched = await failoverToNextTunnel(API_BASE_URL, 'Туннель не отвечает');
      if (switched) return; // страница перезагружается
    }
    showToast(err.message || 'Не удалось удалить игрока', 'error');
  }
}

// Переименовать игрока
async function submitEdit(index) {
  const input = document.getElementById(`nameEdit${index}`);
  const newName = input.value.trim();
  const hall = document.getElementById('hallSelect').value;

  if (!newName) {
    showToast('Введите корректное ФИО', 'error');
    return;
  }

  const parts = newName.split(/\s+/).filter(w => w.length > 0);
  // Правило совпадает с серверным (validateFullName): 3–5 слов
  if (parts.length < 3 || parts.length > 5) {
    showToast('ФИО должно состоять из 3–5 слов: Фамилия Имя Отчество', 'error');
    return;
  }

  const oldName = playersByHall[hall][index];
  if (newName === oldName) {
    cancelEdit(index);
    return;
  }

  editingIndex = null; // снимаем блокировку до перерисовки

  try {
    const response = await fetch(`${API_BASE_URL}/api/player/name`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ currentName: oldName, newName })
    });

    // Токен протух/отозван — разлогиниваем и просим войти заново.
    if (response.status === 403) {
      adminLogout();
      showToast('Сессия администратора истекла — войдите заново', 'error');
      return;
    }

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Не удалось изменить игрока');
    }

    const result = await response.json();
    playersByHall = result.playersByHall;

    const idxInNames = playerNames.indexOf(oldName);
    if (idxInNames !== -1) {
      playerNames[idxInNames] = newName;
    }

    await loadFromAPI();
    showList();
    const _hall3 = document.getElementById('hallSelect').value;
    if (_hall3) { await loadSignupStats(_hall3); showSchedule(); }
    showToast(`Игрок переименован в «${newName}»`, 'success');
  } catch (err) {
    console.error('Ошибка при редактировании через API:', err);
    // Туннель мог отвалиться — пробуем переключиться на резервный.
    if (/\.loca\.lt$/.test(API_BASE_URL)) {
      const switched = await failoverToNextTunnel(API_BASE_URL, 'Туннель не отвечает');
      if (switched) return; // страница перезагружается
    }
    showToast(err.message || 'Не удалось отредактировать игрока', 'error');
  }
}

// ==================== 5. SCHEDULE (ближайшая игра) ====================

function getDayCode(dayName) {
  const map = {
    Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4,
    Friday: 5, Saturday: 6, Sunday: 7
  };
  return map[dayName] || 0;
}

// Обратное преобразование: код дня (1=Пн...7=Вс) → английское имя дня,
// как в расписании. Нужно для дней без слотов (например, игра вне графика).
function dayNameFromCode(dayCode) {
  const map = {
    1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday',
    5: 'Friday', 6: 'Saturday', 7: 'Sunday'
  };
  return map[dayCode] || '';
}

// Общий расчёт ближайшей игры для зала: возвращает
// { date: 'YYYY-MM-DD', text: 'Ближайшая игра: ...', dayDiff } или null.
// Раньше логика была продублирована в getNearestGameDate и getNearestGameText.
function getNearestGame(hall) {
  const now = getMSKNow();
  const nowWeekDay = now.getDay() || 7;

  let nearest = null;
  hallSchedule(hall).forEach(item => {
    const dayCode = getDayCode(item.day);
    const dayDiff = (dayCode - nowWeekDay + 7) % 7;
    if (!nearest || dayDiff < nearest.dayDiff) {
      nearest = { dayDiff, day: item.day, from: item.from, to: item.to };
    }
  });

  if (!nearest) return null;

  const nearestDate = new Date(now);
  nearestDate.setDate(now.getDate() + nearest.dayDiff);
  nearestDate.setHours(nearest.from, 0, 0, 0);

  // Дата уже московская (now построен по МСК) — форматируем напрямую,
  // без toISOString(), который перевёл бы её в UTC и мог сдвинуть день
  const y = nearestDate.getFullYear();
  const m = String(nearestDate.getMonth() + 1).padStart(2, '0');
  const day = String(nearestDate.getDate()).padStart(2, '0');

  const dateOptions = { day: 'numeric', month: 'short', weekday: 'short' };
  const parts = nearestDate.toLocaleString('ru-RU', dateOptions).split(' ');
  const dayNum = parts[1];
  const month = parts[2].replace('.', '');
  const weekday = parts[0].replace(',', '').charAt(0).toUpperCase() + parts[0].slice(1, -1);

  const dateStr = `${y}-${m}-${day}`;

  // Если для этой игры задано изменённое время — показываем его, а не расписание.
  const ov = timeOverride(hall, dateStr);
  const scheduledFrom = `${nearest.from}:00`;
  const startText = ov ? ov.startTime : scheduledFrom;

  // «По расписанию было …» показываем только когда время реально сдвинуто
  // относительно графика (игра «вне расписания» графика не имеет).
  const scheduledText = ov && !ov.isExtra ? (ov.scheduledFrom || scheduledFrom) : null;

  return {
    date: dateStr,
    dayDiff: nearest.dayDiff,
    weekday, dayNum, month,
    startTime: startText,
    scheduledFrom: scheduledText,
    isOverride: !!ov,
    note: ov && ov.note ? ov.note : '',
    text: `Ближайшая игра: ${weekday}, ${dayNum} ${month}, в ${startText}${ov ? ' ⚠️' : ''}`
  };
}

function getNearestGameDate(hall) {
  return getNearestGame(hall)?.date || null;
}

function getNearestGameText(hall) {
  const g = getNearestGame(hall);
  return g ? g.text : 'Ближайшая игра: не найдено';
}

// Выбрать ближайший зал как значение по умолчанию
function selectNearestHall() {
  const now = getMSKNow();
  const nowWeekDay = now.getDay() || 7;
  const nowHour = now.getHours();

  let nearest = null;
  for (const hallId of Object.keys(CONFIG.halls)) {
    hallSchedule(hallId).forEach(item => {
      const dayCode = getDayCode(item.day);
      const dayDiff = (dayCode - nowWeekDay + 7) % 7;
      let timeDiff = dayDiff * 24 + (item.from - nowHour);
      if (timeDiff < 0) timeDiff += 7 * 24;
      if (!nearest || timeDiff < nearest.diff) {
        nearest = { diff: timeDiff, hall: hallId };
      }
    });
  }

  if (nearest) {
    document.getElementById('hallSelect').value = nearest.hall;
  }
}

async function showNearestGame() {
  const hall = document.getElementById('hallSelect').value;
  const info = document.getElementById('nearestGameInfo');

  if (!hall) {
    info.className = '';
    info.textContent = 'Ближайшая игра: не выбран зал';
    return;
  }

  const g = getNearestGame(hall);
  if (!g) {
    info.className = '';
    info.textContent = 'Ближайшая игра: не найдено';
    return;
  }

  // Когда время отличается от расписания — подсвечиваем блок и дописываем
  // подпись «время изменено, (по расписанию было …)» + причину.
  if (g.isOverride) {
    const was = g.scheduledFrom ? ` (по расписанию было ${escapeHtml(g.scheduledFrom)})` : '';
    info.className = 'nearest-changed';
    info.innerHTML = `Ближайшая игра: ${escapeHtml(g.weekday)}, ${escapeHtml(g.dayNum)} ${escapeHtml(g.month)}, в ${escapeHtml(g.startTime)} ⚠️`
      + `<div class="nearest-changed-note">время изменено${was}</div>`
      + (g.note ? `<div class="nearest-changed-reason">Причина: ${escapeHtml(g.note)}</div>` : '');
  } else {
    info.className = '';
    info.textContent = g.text;
  }

  // При первой загрузке — только текст, данные загрузит DOMContentLoaded
  if (isInitialLoad) return;

  // При смене даты/зала — перезагрузить список.
  // Сравниваем полную пару «зал+дата», а не только дату: раньше при
  // переключении залов с одинаковой датой игры данные не обновлялись,
  // и блок стоимости показывал цвета/числа предыдущего зала.
  const key = hall + '|' + (g ? g.date : '');
  if (key !== lastHallDateKey) {
    lastHallDateKey = key;
    // 1. Мгновенная перерисовка из кэша — блок стоимости сразу показывает
    //    данные выбранного зала, без «чужого» цвета на время запроса.
    showList();
    // 2. Фоновая перезагрузка с сервера: подтянет свежие участники
    //    (записи других людей за последние секунды). Во время запроса
    //    интерфейс уже отображает корректные данные из кэша.
    try {
      await loadFromAPI({ silent: true });
    } catch (e) {
      console.error('Ошибка загрузки в showNearestGame:', e);
    }
  }
}

// График игр выбранного зала: сетка недели (Пн–Вс) с подсветкой
// ближайшей игры + карточки информации о зале.
// В днях без игры показывается статистика записей (+N / -N).
let signupStats = null; // кэш: { total, byDate: { '2025-08-25': 3, ... } }

async function loadSignupStats(hall) {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/signup-stats/${hall}`, { headers: getTunnelHeaders() });
    if (!resp.ok) return;
    signupStats = await resp.json();
  } catch (err) {
    // Туннель мог отвалиться — пробуем переключиться на резервный.
    if (/\.loca\.lt$/.test(API_BASE_URL)) {
      const switched = await failoverToNextTunnel(API_BASE_URL, 'Туннель не отвечает');
      if (switched) return; // страница перезагружается
    }
  }
}

// Возвращает дату 'YYYY-MM-DD' для дня недели (1=Пн...7=Вс) в текущей МСК-неделе
function dateForDayCode(dayCode) {
  const now = getMSKNow(); // уже в МСК
  const todayCode = now.getDay() || 7; // 1=Пн...7=Вс
  const diff = dayCode - todayCode;
  const d = new Date(now);
  d.setDate(now.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function showSchedule() {
  const hall = document.getElementById('hallSelect').value;
  const container = document.getElementById('scheduleContainer');
  const content = document.getElementById('scheduleContent');

  container.style.display = 'none';
  content.innerHTML = '';

  if (!CONFIG.halls[hall]) return;

  const h = CONFIG.halls[hall];
  document.getElementById('scheduleHallName').textContent = hallName(hall);
  const now = getMSKNow();
  const todayCode = now.getDay() || 7; // Пн=1 … Вс=7
  const nearest = getNearestGame(hall);

  // Сетка недели: для каждого дня собираем слоты расписания
  const dayCodes = [1, 2, 3, 4, 5, 6, 7];
  const dayLetters = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];
  const gridCells = dayCodes.map((code, i) => {
    const slots = h.schedule.filter(s => getDayCode(s.day) === code);
    const dateStr = dateForDayCode(code);
    const ov = timeOverrides[dateStr]; // изменение времени или доп. игра
    const isToday = code === todayCode;
    const isNearest = nearest && getDayCode(nearest.day) === code;
    const classes = ['sched-cell'];
    if (isToday) classes.push('today');
    if (isNearest) classes.push('nearest');

    // «+N» — активность записи в этот день (по дате подписи), а не число
    // игроков на игру. Запись в субботу на игру во вторник даёт +1 в субботу.
    const dayCnt = (signupStats && signupStats.byDate && signupStats.byDate[dateStr]) || 0;
    const cntHtml = dayCnt > 0 ? `<div class="sched-stats">+${dayCnt}</div>` : '';

    let slotHtml;
    if (ov) {
      // Игра с заданным временем: изменение расписания либо игра вне графика.
      const cls = ov.isExtra ? 'sched-slot sched-slot-extra' : 'sched-slot sched-slot-changed';
      const mark = ov.isExtra ? ' ⭐' : ' ⚠️';
      slotHtml = `<div class="${cls}">${escapeHtml(ov.startTime)}${mark}</div>${cntHtml}`;
    } else if (slots.length) {
      // Показываем только время начала: длительность игры выбирается отдельно.
      slotHtml = slots
        .map(s => `<div class="sched-slot">${String(s.from).padStart(2, '0')}:00</div>`)
        .join('') + cntHtml;
    } else {
      slotHtml = cntHtml || '<div class="sched-off">—</div>';
    }

    return `
      <div class="${classes.join(' ')}">
        <div class="sched-day-letter">${dayLetters[i]}</div>
        ${slotHtml}
        ${isNearest ? '<div class="sched-badge">ближайшая</div>' : ''}
      </div>
    `;
  }).join('');

  const priceDate = getNearestGameDate(hall) || mskToday();
  const { price: rentPrice, hours: rentHours } = gamePrice(hall, priceDate);
  const perPersonFixed = h.perPerson;
  let priceText;
  if (perPersonFixed) {
    // Фиксированная цена с человека (АТЛАНТ): аренда не делится
    priceText = `${perPersonFixed} ₽ с человека (аренда ${rentPrice} ₽)`;
  } else if (rentPrice > 0) {
    priceText = `${rentPrice} ₽ / ${durationLabel(rentHours)} — делится на участников`;
  } else {
    priceText = 'бесплатно';
  }

  content.innerHTML = `
    <div class="sched-grid">${gridCells}</div>
    <div class="sched-info">
      <div class="sched-info-card">
        <div class="sched-info-icon">💰</div>
        <div>
          <div class="sched-info-label">Стоимость аренды</div>
          <div class="sched-info-value">${priceText}</div>
        </div>
      </div>
      <div class="sched-info-card">
        <div class="sched-info-icon">👥</div>
        <div>
          <div class="sched-info-label">Участников в игре</div>
          <div class="sched-info-value">от 10 до ${maxPlayers()} чел.</div>
        </div>
      </div>
      <div class="sched-info-card">
        <div class="sched-info-icon">📞</div>
        <div>
          <div class="sched-info-label">Ответственный</div>
          <div class="sched-info-value">${escapeHtml(hallResp(hall) || '—')}</div>
        </div>
      </div>
    </div>
  `;

  container.style.display = 'block';
}

// ==================== 6. UI (список, история, цены) ====================

// Показать текущие дата и время
function showCurrentDateTime() {
  const now = new Date();
  const options = {
    weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  };
  const dtText = now.toLocaleString('ru-RU', options).replace(',', '');
  document.getElementById('currentDateTime').textContent = 'Сегодня: ' + dtText;
}

// Предвычисленная мапа name → количество прошедших игр в текущем зале.
// Пересчитывается один раз при каждой загрузке данных (loadFromAPI),
// а не O(N×M) для каждого игрока при рендере списка.
let visitCounts = {};

// Строит visitCounts из истории: учитывает ТОЛЬКО ПРОШЕДШИЕ игры
// (дата+21:00 МСК < сейчас). Вызывается после обновления historyByDate.
function rebuildVisitCounts(hall) {
  const counts = {};
  const now = getMSKNow();
  for (const dateStr in historyByDate) {
    const players = historyByDate[dateStr][hall]?.players;
    if (!players) continue;
    const sessionDate = new Date(dateStr + 'T21:00:00');
    if (sessionDate >= now) continue; // только прошедшие
    players.forEach(name => {
      counts[name] = (counts[name] || 0) + 1;
    });
  }
  visitCounts = counts;
}

// Быстрый доступ к счётчику визитов игрока (O(1))
function getPlayerVisits(playerName) {
  return visitCounts[playerName] || 0;
}

// Показать список участников с inline-редактированием и подсчётом суммы
function showList() {
  const hall = document.getElementById('hallSelect').value;
  const result = document.getElementById('result');
  const priceElem = document.getElementById('pricingRow');
  const players = playersByHall[hall] || [];

  if (!hall) {
    result.innerHTML = '<p>Выберите зал, чтобы увидеть список участников.</p>';
    priceElem.textContent = 'Стоимость к оплате: не выбран зал.';
    return;
  }

  const hallText = hallName(hall);
  const resp = hallResp(hall);

  result.innerHTML = `
    <div class="list-header">
      <span>Все записавшиеся в <span class="list-header-hall">${escapeHtml(hallText)}</span></span>
      <span class="teams-icon" title="Сформировать команды" onclick="openTeamsModal()">🎲</span>
    </div>
    ${resp ? `
      <div class="responsible-line">
        Ответственный: ${escapeHtml(resp)}
      </div>
    ` : ''}
  `;

  if (players.length === 0) {
    result.innerHTML += '<p>Список пока пуст.</p>';
  } else {
    const list = players.map((name, i) => {
      const idx = i + 1;
      // Игрок сверх лимита — красным (класс, а не inline-стиль)
      const overLimitCls = idx <= maxPlayers() ? '' : ' player-over-limit';
      return `
        <div class="playerLine" id="playerLine${i}">
          <div class="playerName">
            <span class="playerNameMain ${overLimitCls.trim()}">
              <span class="playerNameText">${idx}. ${escapeHtml(name)}</span>
              <span class="playerNameTg">${telegramLinkHtml(name)}</span>
              <span class="visit-count">${getPlayerVisits(name)} <span class="visit-plus">+1</span></span>
            </span>
            <input type="text" id="nameEdit${i}" class="player-name-edit" value="${escapeHtml(name)}" />
          </div>
          <div class="icons">
            ${isAdmin() ? `
              <span class="icon-btn icon-edit" onclick="startEdit(${i})">✎</span>
              <span class="icon-btn icon-save" onclick="submitEdit(${i})">✔</span>
              <span class="icon-btn icon-cancel" onclick="cancelEdit(${i})">✖</span>
            ` : ''}
            <span class="icon-btn icon-delete" onclick="openDeleteModal(${i})" title="Удалить">🗑️</span>
          </div>
        </div>
      `;
    }).join('');
    result.innerHTML += list;
  }

  // Индикатор заполненности: ширина — динамическая (inline), цвет — классом
  const perc = Math.min(100, (players.length / maxPlayers()) * 100);
  const barCls = players.length < 10 ? 'fill-bar-low' : 'fill-bar-ok';

  result.innerHTML += `
    <div class="fill-info">
      Заполненность:
      <span class="fill-count">${players.length} / ${maxPlayers()} человек</span>
      <div class="fill-bar-track">
        <div class="fill-bar-fill ${barCls}" style="width: ${perc}%;"></div>
      </div>
    </div>
  `;

  renderPricingRow(hall, players.length);
  showHistoryTable();
}

// Длительность игры в часах по времени начала/конца 'HH:MM' (с переходом
// через полночь). Если данных нет — 2 часа (как в админке по умолчанию).
function gameDurationHours(hall, dateStr) {
  const info = gameTimeCache[`${hall}|${dateStr}`];
  const start = info && info.startTime;
  const end = info && info.endTime;
  if (!start || !end || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return 2;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return diff / 60;
}

// Цена аренды и её ключ ('short' 1,5 ч | 'full' 2 ч) по длительности,
// заданной администратором в админ-панели. Без данных — 2 часа ('full').
function gamePrice(hall, dateStr) {
  const hours = gameDurationHours(hall, dateStr);
  const durationKey = hours <= 1.25 ? 'hourly' : (hours <= 1.75 ? 'short' : 'full');
  return { durationKey, price: hallPrice(hall, durationKey), hours };
}

// Человекочитаемое описание длительности из часов.
function durationLabel(hours) {
  if (hours <= 1.25) return '1 час';
  if (hours <= 1.75) return '1 час 30 мин';
  return '2 часа';
}

// Строка «стоимость к оплате».
// Два режима (настраивается полем perPerson в конфиге зала):
//  - perPerson задан (АТЛАНТ): фиксированная сумма с человека, аренда
//    всегда 6000 ₽ и НЕ делится на количество участников;
//  - perPerson не задан (ЛОКОМОТИВ): стоимость аренды делится на
//    всех записавшихся (в пределах лимита maxPlayers).
function renderPricingRow(hall, playersCount) {
  const priceElem = document.getElementById('pricingRow');
  const MIN_PLAYERS = 10;

  // 0 участников — пустое состояние
  if (playersCount === 0) {
    priceElem.innerHTML = '<span class="pricing-empty">Участников пока нет — запишитесь первым!</span>';
    return;
  }

  // Меньше минимума — только предупреждение со счётчиком
  if (playersCount < MIN_PLAYERS) {
    priceElem.classList.add('pricing-warn');
    priceElem.innerHTML = `
      <div class="pricing-registered under-min">
        Записалось: ${playersCount} чел. ⚠️ Меньше минимума (${MIN_PLAYERS}) — игра может не состояться!
      </div>
    `;
    return;
  }

  // Минимум достигнут — полный блок: стоимость + телефон.
  // Длительность и цену берём из админ-панели (время игры), не с формы.
  priceElem.classList.remove('pricing-warn');
  const dateStr = getNearestGameDate(hall) || mskToday();
  const { price, hours } = gamePrice(hall, dateStr);
  const durationText = durationLabel(hours);
  const perPersonFixed = CONFIG.halls[hall]?.perPerson;
  const phone = hallPhone(hall);

  let perPersonAmount;
  let payNote;
  if (perPersonFixed) {
    perPersonAmount = String(perPersonFixed);
    payNote = 'Сумма фиксированная, не делится на участников.';
  } else {
    const activeCount = Math.min(maxPlayers(), playersCount);
    perPersonAmount = (price / activeCount).toFixed(2);
    payNote = `Оплачивать будут ${activeCount} чел. (в пределах лимита ${maxPlayers()}).`;
  }

  priceElem.innerHTML = `
    <div class="pricing-line">Стоимость аренды зала: ${price} ₽${perPersonFixed ? ' (фиксированно)' : ''}</div>
    <div class="pricing-line">Время аренды: ${durationText}</div>
    <div class="pricing-line">${payNote}</div>
    <div class="pricing-amount"><strong>Каждому нужно заплатить: ${perPersonAmount} ₽</strong></div>
    <div class="pricing-registered">Записалось: ${playersCount} чел.</div>
    <div class="phone-block">
      Для оплаты переведите деньги на телефон:
      <br />
      <span class="phone-number" id="displayPhone" title="Нажмите: копирует номер и открывает Сбербанк">${escapeHtml(phone)}</span>
      <button class="phone-copy-btn" onclick="copyPhoneToClipboard('${escapeHtml(phone)}')" title="Копировать телефон">📋</button>
    </div>
  `;
}

// Человекочитательная дата из 'YYYY-MM-DD' (московская): «вт, 19 авг»
function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const text = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
  return text.replace('.', '');
}

// «Фамилия Имя» из полного ФИО (отчество опускаем).
function shortName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(' ');
}

// История записей в виде карточек-таймлайна под списком участников
function showHistoryTable() {
  const hall = document.getElementById('hallSelect').value;
  const historyTableContainer = document.getElementById('historyTableContainer');
  historyTableContainer.innerHTML = '';
  historyTableContainer.style.display = 'none';

  if (!hall) return;

  // Записи только для этого зала, последние 2 по дате СРЕДИ ПРОШЕДШИХ,
  // чтобы будущая запланированная игра не показывалась как «предыдущая».
  const today = mskToday();
  const entries = Object.keys(historyByDate)
    .filter(dateStr => dateStr < today)
    .map(dateStr => {
      const h = historyByDate[dateStr][hall] || {};
      return {
        date: dateStr,
        players: h.players || [],
        confirmed: !!h.confirmed,
        price: h.price,
        duration: h.duration
      };
    })
    .filter(e => e.players.length > 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 2);

  if (entries.length === 0) return;

  historyTableContainer.style.display = 'block';

  const cards = entries.map((entry, i) => {
    const label = i === 0 ? 'предыдущая игра' : 'игра до неё';
    const chips = entry.players.map(p => `<span class="hist-chip">${escapeHtml(shortName(p))}</span>`).join('');
    // Мета-маркеры одного размера. Порядок для подтверждённой игры:
    // Время → Количество → Стоимость. Без иконок, «₽» идёт после суммы.
    const marks = [];
    if (entry.confirmed && entry.duration != null) {
      marks.push(`<span class="hist-meta-item hist-meta-time" title="Длительность игры">${escapeHtml(durationLabel(entry.duration))}</span>`);
    }
    marks.push(`<span class="hist-meta-item hist-meta-count" title="Число записавшихся">${entry.players.length} чел.</span>`);
    if (entry.confirmed && entry.price != null) {
      marks.push(`<span class="hist-meta-item hist-meta-price" title="Сумма к оплате за одного человека">${escapeHtml(entry.price)} ₽/чел.</span>`);
    }
    return `
      <div class="hist-card${entry.confirmed ? ' hist-card-confirmed' : ''}">
        <div class="hist-head">
          <div class="hist-date">
            <span class="hist-date-main">${formatShortDate(entry.date)}</span>
            <span class="hist-date-sub">${label}</span>
          </div>
          <div class="hist-meta">${marks.join('')}</div>
        </div>
        <div class="hist-chips">${chips}</div>
      </div>
    `;
  }).join('');

  const histIcon = `<svg class="hist-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="4.5" width="16" height="17" rx="2"/>
      <rect x="8.5" y="2.5" width="7" height="3.2" rx="1.2"/>
      <rect x="6.6" y="9" width="3.2" height="3.2" rx="0.8"/>
      <path d="M7.3 10.6l0.9 0.9 1.5-1.7"/>
      <line x1="12" y1="10.6" x2="17.4" y2="10.6"/>
      <rect x="6.6" y="13.6" width="3.2" height="3.2" rx="0.8"/>
      <path d="M7.3 15.2l0.9 0.9 1.5-1.7"/>
      <line x1="12" y1="15.2" x2="17.4" y2="15.2"/>
      <rect x="6.6" y="18.2" width="3.2" height="3.2" rx="0.8"/>
      <path d="M7.3 19.8l0.9 0.9 1.5-1.7"/>
      <line x1="12" y1="19.8" x2="17.4" y2="19.8"/>
    </svg>`;

  historyTableContainer.innerHTML = `
    <h3 class="hist-title">${histIcon}История записей — ${escapeHtml(hallName(hall))}</h3>
    <div class="hist-timeline">${cards}</div>
  `;
}

// ==== Автодополнение ФИО (кастомный dropdown вместо нативного datalist) ====
let autocompleteIndex = -1; // индекс выделенной подсказки (-1 — ничего не выбрано)

// Нормализация для сравнения: без регистра, ё→е, без пунктуации/лишних пробелов
function normalizeName(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Все уникальные ФИО из базы (текущие игроки + история)
function collectAllNamesFromHistory() {
  const allNames = new Set();
  playerNames.forEach(name => { if (name) allNames.add(name.trim()); });
  for (const dateStr in historyByDate) {
    const dateData = historyByDate[dateStr];
    for (const hallId in dateData) {
      (dateData[hallId]?.players || []).forEach(name => {
        if (name) allNames.add(name.trim());
      });
    }
  }
  return Array.from(allNames);
}

// Фильтрация подсказок по введённому тексту.
// Совпадение, если нормализованное ФИО содержит нормализованный ввод
// (в любом месте строки — удобно искать по фамилии или имени).
function filterAutocomplete(query) {
  const q = normalizeName(query);
  if (!q) return [];
  return collectAllNamesFromHistory()
    .filter(name => normalizeName(name).includes(q))
    .sort((a, b) => {
      // Сначала точные совпадения и совпадения с начала слова
      const aStarts = normalizeName(a).startsWith(q) ? 0 : 1;
      const bStarts = normalizeName(b).startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.localeCompare(b, 'ru');
    })
    .slice(0, 8); // не более 8 подсказок
}

function renderAutocomplete(matches) {
  const box = document.getElementById('autocompleteBox');
  if (!box) return;

  if (!matches.length) {
    box.style.display = 'none';
    autocompleteIndex = -1;
    return;
  }

  box.innerHTML = matches.map((name, i) => `
    <div class="ac-item${i === autocompleteIndex ? ' active' : ''}" data-name="${escapeHtml(name)}">
      ${escapeHtml(name)}
    </div>
  `).join('');
  box.style.display = 'block';

  box.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      // mousedown раньше blur — успеваем выбрать до потери фокуса
      e.preventDefault();
      selectAutocomplete(item.dataset.name);
    });
  });
}

function showAutocomplete() {
  const input = document.getElementById('playerName');
  const matches = filterAutocomplete(input.value);
  autocompleteIndex = matches.length > 0 ? 0 : -1;
  renderAutocomplete(matches);
}

function hideAutocomplete() {
  const box = document.getElementById('autocompleteBox');
  if (box) box.style.display = 'none';
  autocompleteIndex = -1;
}

function selectAutocomplete(name) {
  const input = document.getElementById('playerName');
  input.value = name;
  hideAutocomplete();
  validatePlayerName();
  input.focus();
}

// Навигация стрелками по подсказкам
function moveAutocomplete(delta) {
  const box = document.getElementById('autocompleteBox');
  if (!box || box.style.display !== 'block') return;
  const items = box.querySelectorAll('.ac-item');
  if (!items.length) return;

  autocompleteIndex = (autocompleteIndex + delta + items.length) % items.length;
  items.forEach((item, i) => item.classList.toggle('active', i === autocompleteIndex));
  // Прокрутка к активному элементу
  items[autocompleteIndex].scrollIntoView({ block: 'nearest' });
}

// Валидация ФИО. UX4: вызывается на каждом input (live), а не только на blur.
// Пустое поле — нейтральное состояние; непустое с <3 слов — ошибка.
function validatePlayerName() {
  const input = document.getElementById('playerName');
  const error = document.getElementById('playerNameError');
  const btn = document.querySelector('button[onclick="addPlayer()"]');
  const name = input.value.trim();
  const words = name.split(/\s+/).filter(w => w.length > 0);

  // Правило совпадает с серверным (validateFullName): 3–5 слов
  const invalid = name.length > 0 && (words.length < 3 || words.length > 5);

  if (invalid) {
    input.classList.add('input-invalid');
    error.style.display = 'block';
  } else {
    resetInputStyles(input, error);
  }

  // Кнопка активна, только когда ФИО введено полностью и БД доступна
  if (btn) {
    const dbBlocked = !dbOnline;
    const nameInvalid = !name || words.length < 3 || words.length > 5;
    btn.disabled = dbBlocked || btn.dataset.loading === '1' || nameInvalid;
    btn.title = dbBlocked
      ? 'Нет соединения с базой данных'
      : nameInvalid ? 'Введите ФИО: 3–5 слов (Фамилия Имя Отчество)' : '';
  }
}

function resetInputStyles(input, error) {
  input.classList.remove('input-invalid');
  error.style.display = 'none';
}

// Inline-редактирование имени
function startEdit(index) {
  const line = document.getElementById(`playerLine${index}`);
  const span = line.querySelector('.playerName span');
  const input = document.getElementById(`nameEdit${index}`);

  span.style.display = 'none';
  input.style.display = 'inline-block';
  input.focus();
  input.select();

  // Иконки ✎/✔/✖ переключаются CSS-классом .editing на строке
  line.classList.add('editing');

  editingIndex = index; // UX1: блокируем фоновую перерисовку

  // Enter — сохранить, ESC — отменить
  input.onkeydown = function (e) {
    if (e.key === 'Enter') { e.preventDefault(); submitEdit(index); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(index); }
  };
}

function cancelEdit(index) {
  editingIndex = null;
  showList();
}

// ==================== 7. TEAMS (модалка с командами) ====================

function openTeamsModal() {
  const hall = document.getElementById('hallSelect').value;
  const players = playersByHall[hall] || [];

  if (players.length === 0) {
    showToast('Сначала запишитесь хотя бы один участник', 'error');
    return;
  }

  const modal = document.getElementById('teamsModal');
  const content = document.getElementById('teamsContent');
  content.innerHTML = '';

  const numTeams = players.length >= 15 ? 3 : 2;
  const shuffled = shuffleArray(players);

  const teams = Array.from({ length: numTeams }, () => []);
  for (let i = 0; i < shuffled.length; i++) {
    teams[i % numTeams].push(shuffled[i]);
  }

  let inner = `
    <p class="teams-summary">Всего игроков: <strong>${players.length}</strong></p>
    <p class="teams-summary">Сформировано команд: <strong>${numTeams}</strong></p>
  `;

  teams.forEach((team, idx) => {
    const items = team.map((name, i) => {
      const cls = i === 5 ? 'team-player-item team-player-gap' : 'team-player-item';
      return `<li class="${cls}">${escapeHtml(name)}</li>`;
    }).join('');

    inner += `
      <div class="team-card">
        <div class="team-title">Команда ${idx + 1} (${team.length} человек)</div>
        <div class="team-main">
          <ol class="team-main-ol">
            ${items}
          </ol>
        </div>
      </div>
    `;
  });

  content.innerHTML = inner;
  modal.style.display = 'flex';
}

function rerollTeams() {
  openTeamsModal();
}

function closeTeamsModal() {
  document.getElementById('teamsModal').style.display = 'none';
}

// ==================== 7.5. CHANGELOG (модалка истории версий) ====================

const CHANGELOG = [
  {
    label: 'v2026.10.03 — подтверждение игры',
    items: [
      '✅ Админ отмечает игру подтверждённой (кнопка красная → зелёная)',
      '💰 В истории у подтверждённой игры — сумма к оплате на человека',
      '🔄 Подтверждение хранится по дате и переживает перезагрузку страницы',
      '🕒 Длительность задаётся только в админ-панели; с главной формы выбор убран'
    ]
  },
  {
    label: 'v2026.10.01 — Telegram-аккаунты в списке',
    items: [
      '🔗 Возле имени игрока — кликабельная ссылка на профиль Telegram',
      '📐 ФИО слева, справа — @аккаунт и счётчик визитов (ровной колонкой)',
      '📲 Тап по @аккаунту открывает приложение Telegram с диалогом'
    ]
  },
  {
    label: 'v2026.10.01 — мобильная вёрстка',
    items: [
      '📱 Сетка недели компактнее: без полных названий дней',
      '⚙️ Админ-панель адаптирована под телефоны: поля не выходят за экран'
    ]
  },
  {
    label: 'v2026.10.01 — админ и время игры',
    items: [
      '⚠️ Предупреждение, если время игры отличается от расписания',
      '⚙️ Админ-панель: вход долгим нажатием на версию внизу страницы',
      '✏️ Редактирование имени — только для администратора',
      '🕒 Изменение времени игры без перезапуска сервера'
    ]
  },
  {
    label: 'v2026.09.28 — запуск в облаке',
    items: [
      '☁️ Сайт переехал в облако и работает круглосуточно',
      '🌍 Постоянный адрес: ball76.duckdns.org',
      '🔒 Защищённое соединение (HTTPS)',
      '⚡ Стабильная работа без туннелей'
    ]
  },
  {
    version: 'p',
    items: [
      '📊 В днях без игры — статистика записей на ближайшую игру'
    ]
  },
  {
    version: 'o',
    items: [
      '💰 Стоимость и телефон показаны только после 10 записавшихся'
    ]
  },
  {
    version: 'n',
    items: [
      '💰 Блок стоимости и телефона появляется только после первой записи'
    ]
  },
  {
    version: 'm',
    items: [
      '👤 ФИО подставляется автоматически при следующем визите'
    ]
  },
  {
    version: 'l',
    items: [
      '🎨 Единый стиль всех модальных окон'
    ]
  },
  {
    version: 'k',
    items: [
      '🎨 Красивая модалка истории изменений'
    ]
  },
  {
    version: 'j',
    items: [
      '📱 Тап по номеру телефона открывает Сбербанк (СБП)',
      '🏷️ Версия внизу стала кликабельной — история изменений'
    ]
  },
  {
    version: 'i',
    items: [
      '⚡ Страница сразу работает через туннель, без лишних окон'
    ]
  },
  {
    version: 'g',
    items: [
      '🔄 Список участников обновляется автоматически каждые 30 сек',
      '✏️ Редактирование имени прямо в списке (без формы)',
      '🗑️ Подтверждение перед удалением игрока',
      '💡 Подсказки ФИО при вводе (из истории записей)',
      '📊 Полоска заполненности зала (зелёная / жёлтая)',
      '🎲 Кнопка формирования команд',
      '📞 Копирование номера телефона тапом'
    ]
  }
];

// Обычный клик по версии — changelog; после долгого нажатия клик подавляется
// (иначе после входа в админ тут же открывалась бы история версий).
function onVersionClick() {
  if (suppressVersionClick) {
    suppressVersionClick = false;
    return;
  }
  openChangelogModal();
}

function openChangelogModal() {
  const modal = document.getElementById('changelogModal');
  const content = document.getElementById('changelogContent');

  content.innerHTML = CHANGELOG.map(entry => `
    <div class="changelog-entry">
      <div class="changelog-version">${entry.label ? entry.label : `v2026.08.25-${entry.version}`}</div>
      <ul class="changelog-items">
        ${entry.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </div>
  `).join('');

  modal.style.display = 'flex';
}

function closeChangelogModal() {
  document.getElementById('changelogModal').style.display = 'none';
}

// ==================== 7.6. TIME OVERRIDE (время игры) ====================

// Текущее эффективное время игры для выбранного зала/даты (с сервера).
let currentGameTime = null;
// Кэш времени по ключу 'hall|date' — чтобы «Ближайшая игра» и график
// показывали изменённое время, а не только расписание.
const gameTimeCache = {};

// Запросить время игры (override или расписание) и обновить баннер/уведомление.
async function loadGameTime(hall, date) {
  if (!hall || !date) return;
  try {
    const resp = await fetch(`${API_BASE_URL}/api/games/${hall}/${date}/time`, { headers: getTunnelHeaders() });
    if (!resp.ok) return;
    currentGameTime = await resp.json();
    gameTimeCache[`${hall}|${date}`] = currentGameTime;
    renderTimeBanner(currentGameTime, hall, date);
    // Обновить тексты, где время берётся из расписания.
    if (typeof showNearestGame === 'function') showNearestGame();
    // Длительность/цена на главной берутся из времени игры — пересчитываем
    // список и карточку стоимости в расписании, если это текущий зал.
    const sel = document.getElementById('hallSelect');
    if (sel && sel.value === hall) {
      if (typeof showList === 'function') showList();
      if (typeof showSchedule === 'function') showSchedule();
    }
  } catch (_) { /* нет данных о времени — не критично */ }
}

// Изменённое (override) время для зала/даты или null.
function timeOverride(hall, date) {
  const info = gameTimeCache[`${hall}|${date}`];
  return info && info.isOverride ? info : null;
}

// Будущие изменения времени по залу: { 'YYYY-MM-DD': { startTime, isExtra, note } }.
let timeOverrides = {};

async function loadTimeOverrides(hall) {
  if (!hall) return;
  try {
    const resp = await fetch(`${API_BASE_URL}/api/games/${hall}/time-overrides`, { headers: getTunnelHeaders() });
    if (!resp.ok) return;
    const data = await resp.json();
    timeOverrides = data.overrides || {};
    // Заносим в общий кэш времени, чтобы «Ближайшая игра» их тоже видела.
    for (const date in timeOverrides) {
      const t = timeOverrides[date];
      gameTimeCache[`${hall}|${date}`] = {
        startTime: t.startTime,
        endTime: null,
        note: t.note || '',
        isOverride: true,
        isExtra: !!t.isExtra,
        scheduledFrom: null,
        scheduledTo: null
      };
    }
  } catch (_) { /* не критично */ }
}

// Информация об изменении времени теперь выводится прямо в блоке
// «Ближайшая игра» (см. showNearestGame), поэтому отдельный баннер не нужен.
// Здесь остаётся только разовое модальное уведомление для игроков.
function renderTimeBanner(info, hall, date) {
  if (!info || !info.isOverride) return;
  maybeShowTimeNotice(info, hall, date);
}

// Показать модалку-уведомление один раз на устройство для конкретного изменения.
function maybeShowTimeNotice(info, hall, date) {
  const stamp = String(info.changedAt || info.startTime);
  const key = `ball76_time_notice_${hall}_${date}`;
  let seen = null;
  try { seen = localStorage.getItem(key); } catch (_) {}
  if (seen === stamp) return;

  const body = document.getElementById('timeNoticeBody');
  const modal = document.getElementById('timeNoticeModal');
  if (!body || !modal) return;

  body.innerHTML = `
    <p>Время игры <strong>${escapeHtml(hallName(hall))}</strong> на ${formatDateHuman(date)} изменено.</p>
    <p class="time-notice-big">${escapeHtml(info.startTime)}</p>
    ${info.scheduledFrom ? `<p class="time-notice-was">По расписанию было ${escapeHtml(info.scheduledFrom)}</p>` : ''}
    ${info.note ? `<p class="time-notice-reason">Причина: ${escapeHtml(info.note)}</p>` : ''}
  `;
  modal.style.display = 'flex';
  try { localStorage.setItem(key, stamp); } catch (_) {}
}

function closeTimeNotice() {
  document.getElementById('timeNoticeModal').style.display = 'none';
}

// Человекочитаемая дата из YYYY-MM-DD (для уведомления).
function formatDateHuman(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00Z');
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  } catch (_) {
    return dateStr;
  }
}

// ==================== 7.7. ADMIN (вход длинным нажатием на версию) ====================

const ADMIN_TOKEN_KEY = 'ball76_admin_token';
let adminToken = null;
try { adminToken = localStorage.getItem(ADMIN_TOKEN_KEY); } catch (_) {}

// Состояние подтверждения текущей игры (зал+дата), загружается из API.
let adminConfirmState = { confirmed: false, price: null, players: null };

function isAdmin() { return !!adminToken; }

// Показать/скрыть баннер «Режим администратора» над строкой даты.
function updateAdminStatusBar() {
  const bar = document.getElementById('adminStatusBar');
  if (bar) bar.style.display = isAdmin() ? 'flex' : 'none';
}

function adminHeaders() {
  // Включаем и tunnel-bypass заголовки: админ-запросы идут так же через loca.lt.
  const h = { 'Content-Type': 'application/json', ...getTunnelHeaders() };
  if (adminToken) h['X-Admin-Token'] = adminToken;
  return h;
}

// Длинное нажатие на версию в футере → вход в админ-панель.
let versionPressTimer = null;
let suppressVersionClick = false;

function initAdminLongPress() {
  const el = document.getElementById('appVersion');
  if (!el) return;

  const start = () => {
    clearTimeout(versionPressTimer);
    versionPressTimer = setTimeout(() => {
      suppressVersionClick = true; // подавляем обычный клик по версии (changelog)
      if (isAdmin()) openAdminPanel();
      else openAdminLogin();
    }, 1500);
  };
  const cancel = () => clearTimeout(versionPressTimer);

  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
}

function openAdminLogin() {
  const modal = document.getElementById('adminLoginModal');
  const err = document.getElementById('adminLoginError');
  const input = document.getElementById('adminPassword');
  if (err) err.textContent = '';
  if (input) input.value = '';
  modal.style.display = 'flex';
  setTimeout(() => input && input.focus(), 100);
}

function closeAdminLogin() {
  document.getElementById('adminLoginModal').style.display = 'none';
}

async function submitAdminLogin() {
  const input = document.getElementById('adminPassword');
  const err = document.getElementById('adminLoginError');
  const password = (input?.value || '').trim();
  if (!password) { if (err) err.textContent = 'Введите пароль'; return; }

  try {
    const resp = await fetch(`${API_BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!resp.ok) {
      if (err) err.textContent = 'Неверный пароль';
      return;
    }
    const data = await resp.json();
    adminToken = data.token;
    try { localStorage.setItem(ADMIN_TOKEN_KEY, adminToken); } catch (_) {}
    closeAdminLogin();
    showToast('Вход выполнен', 'success');
    updateAdminStatusBar();
    showList(); // перерисовать список — появятся иконки редактирования
    openAdminPanel();
  } catch (_) {
    if (err) err.textContent = 'Ошибка соединения с сервером';
  }
}

function openAdminPanel() {
  const modal = document.getElementById('adminModal');
  const hallSelect = document.getElementById('adminHallSelect');
  const dateInput = document.getElementById('adminDateInput');

  // Зал — как на основной форме; дата — ближайшая игра или сегодня.
  const mainHall = document.getElementById('hallSelect').value || 'hall1';
  hallSelect.value = mainHall;

  // Запрещаем выбирать прошедшие даты (min = сегодня по МСК).
  dateInput.min = mskToday();

  if (!dateInput.value) {
    const nearest = getNearestGameDate(mainHall);
    dateInput.value = nearest || mskToday();
  }

  modal.style.display = 'flex';
  loadAdminGameTime();
}

function closeAdminPanel() {
  document.getElementById('adminModal').style.display = 'none';
}

function adminLogout() {
  adminToken = null;
  try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch (_) {}
  closeAdminPanel();
  updateAdminStatusBar();
  showToast('Вы вышли из админа', 'info');
  showList();
}

// Прибавить часы (может быть дробным: 1, 1.5, 2) к времени 'HH:MM'.
// Возвращает 'HH:MM' в пределах суток.
function addHoursToTime(time, hours) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return '';
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m + Math.round(hours * 60)) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Определить длительность (1 | 1.5 | 2) по началу и концу. По умолчанию 2.
function durationFromTimes(start, end) {
  if (!start || !end || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return '2';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  const hours = diff / 60;
  if (hours <= 1.25) return '1';
  if (hours <= 1.75) return '1.5';
  return '2';
}

// Подтянуть текущее время игры в поля формы.
async function loadAdminGameTime() {
  const hall = document.getElementById('adminHallSelect').value;
  const date = document.getElementById('adminDateInput').value;
  const hint = document.getElementById('adminScheduleHint');
  if (!hall || !date) return;

  // До загрузки — разблокируем (если предыдущая дата была подтверждена).
  applyConfirmLock(false);

  try {
    const resp = await fetch(`${API_BASE_URL}/api/games/${hall}/${date}/time`, { headers: getTunnelHeaders() });
    if (!resp.ok) return;
    const info = await resp.json();

    document.getElementById('adminStartTime').value = info.startTime || '';
    // Длительность определяем по разнице начала и конца; если данных нет — 2 ч.
    document.getElementById('adminDuration').value = durationFromTimes(info.startTime, info.endTime);
    document.getElementById('adminNote').value = info.note || '';

    // Состояние подтверждения (обратимое) — кнопка красная/зелёная.
    adminConfirmState = {
      confirmed: !!info.confirmed,
      price: info.confirmedPrice != null ? info.confirmedPrice : null,
      players: info.confirmedPlayers != null ? info.confirmedPlayers : null
    };
    updateConfirmButton();

    if (hint) {
      if (info.scheduledFrom) {
        // Обычный день расписания.
        hint.textContent = `По расписанию: ${info.scheduledFrom}${info.scheduledTo ? '–' + info.scheduledTo : ''}`;
        hint.classList.remove('admin-hint-extra');
      } else if (info.isOverride) {
        // Игра на этот день уже запланирована (вне графика) — не путаем
        // админа фразой «игры нет»: время задано ниже в поле.
        hint.textContent = '📌 Игра запланирована вне обычного графика';
        hint.classList.add('admin-hint-extra');
      } else {
        // Игры на эту дату действительно нет — можно назначить время.
        hint.textContent = '📌 На эту дату игра не запланирована';
        hint.classList.add('admin-hint-extra');
        // Подставим привычное время по умолчанию, чтобы админ не вводил с нуля.
        const defFrom = getDefaultStartTime(hall);
        if (defFrom) document.getElementById('adminStartTime').value = defFrom;
      }
    }
    updateAdminPreview();
  } catch (_) { /* игнорируем — форма остаётся пустой */ }
}

function updateAdminPreview() {
  const hall = document.getElementById('adminHallSelect').value;
  const date = document.getElementById('adminDateInput').value;
  const start = document.getElementById('adminStartTime').value;
  const duration = Number(document.getElementById('adminDuration').value || 2);
  const note = document.getElementById('adminNote').value.trim();
  const preview = document.getElementById('adminPreview');
  if (!preview) return;

  if (!start) { preview.textContent = 'Укажите время начала'; return; }

  const end = addHoursToTime(start, duration);
  preview.innerHTML = `Предпросмотр для игроков: <br>⚠️ <strong>Время игры:</strong> `
    + `начало в ${escapeHtml(start)}${end ? `, конец в ${escapeHtml(end)}` : ''}`
    + (note ? `<br>Причина: ${escapeHtml(note)}` : '');
}

async function saveGameTime() {
  const hall = document.getElementById('adminHallSelect').value;
  const date = document.getElementById('adminDateInput').value;
  const startTime = document.getElementById('adminStartTime').value;
  const duration = Number(document.getElementById('adminDuration').value || 2);
  const note = document.getElementById('adminNote').value.trim();

  if (!date) { showToast('Укажите дату', 'error'); return; }
  if (!startTime) { showToast('Укажите время начала', 'error'); return; }
  if (!note) { showToast('Укажите причину изменения', 'error'); return; }

  // Конец вычисляем из начала + выбранной длительности (1 / 1,5 / 2 ч).
  const endTime = addHoursToTime(startTime, duration) || null;

  try {
    const resp = await fetch(`${API_BASE_URL}/api/games/${hall}/${date}/time`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ startTime, endTime, note })
    });
    if (resp.status === 403) { adminLogout(); return; }
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      showToast(e.error || 'Не удалось сохранить', 'error');
      return;
    }
    showToast('Время игры обновлено', 'success');
    // Обновляем баннер/уведомление, сетку недели и список для игроков.
    await loadTimeOverrides(hall);
    if (date === getNearestGameDate(hall)) await loadGameTime(hall, date);
    showList();
    showSchedule();
  } catch (_) {
    showToast('Ошибка соединения с сервером', 'error');
  }
}

// Отрисовать кнопку подтверждения: красная (не подтверждена) /
// зелёная (подтверждена). Текст подсказывает, что произойдёт по клику.
function updateConfirmButton() {
  const btn = document.getElementById('adminConfirmBtn');
  if (!btn) return;
  const on = adminConfirmState.confirmed;
  btn.classList.toggle('confirmed', on);
  btn.classList.toggle('unconfirmed', !on);
  btn.textContent = on
    ? `Игра подтверждена${adminConfirmState.price != null ? ` — ${adminConfirmState.price} ₽/чел.` : ''}`
    : 'Подтвердить игру';
  btn.title = on ? 'Нажмите, чтобы снять подтверждение' : 'Отметить игру как подтверждённую';
  // Пока игра подтверждена — время/длительность/причина зафиксированы.
  applyConfirmLock(on);
}

// Блокировка полей времени, пока игра подтверждена: админ не может случайно
// изменить согласованное время/длительность/причину. Кнопки «Сохранить» и
// «Сбросить к расписанию» скрываются. Снятие подтверждения возвращает доступ.
function applyConfirmLock(locked) {
  ['adminDateInput', 'adminStartTime', 'adminDuration', 'adminNote'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = locked;
    el.classList.toggle('locked-field', locked);
  });
  const save = document.getElementById('adminSaveBtn');
  if (save) save.style.display = locked ? 'none' : '';
  const reset = document.getElementById('adminResetBtn');
  if (reset) reset.style.display = locked ? 'none' : '';
}

// Переключить подтверждение игры (админ). Обратимо.
async function toggleGameConfirm() {
  const hall = document.getElementById('adminHallSelect').value;
  const date = document.getElementById('adminDateInput').value;
  if (!date) { showToast('Укажите дату', 'error'); return; }

  const btn = document.getElementById('adminConfirmBtn');
  if (btn) btn.disabled = true;
  try {
    const resp = await fetch(`${API_BASE_URL}/api/games/${hall}/${date}/confirm`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ confirmed: !adminConfirmState.confirmed })
    });
    if (resp.status === 403) { adminLogout(); return; }
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      showToast(e.error || 'Не удалось изменить подтверждение', 'error');
      return;
    }
    const info = await resp.json();
    adminConfirmState = {
      confirmed: !!info.confirmed,
      price: info.confirmedPrice != null ? info.confirmedPrice : null,
      players: info.confirmedPlayers != null ? info.confirmedPlayers : null
    };
    updateConfirmButton();
    showToast(adminConfirmState.confirmed ? 'Игра подтверждена' : 'Подтверждение снято', 'success');
    // Обновляем историю и данные для игроков (сумма/маркер).
    await loadFromAPI({ silent: true, refreshHall: false });
    showHistoryTable();
  } catch (_) {
    showToast('Ошибка соединения с сервером', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function resetGameTime() {
  const hall = document.getElementById('adminHallSelect').value;
  const date = document.getElementById('adminDateInput').value;
  if (!date) { showToast('Укажите дату', 'error'); return; }

  try {
    const resp = await fetch(`${API_BASE_URL}/api/games/${hall}/${date}/time`, {
      method: 'DELETE',
      headers: adminHeaders()
    });
    if (resp.status === 403) { adminLogout(); return; }
    if (!resp.ok) { showToast('Не удалось сбросить', 'error'); return; }
    showToast('Время сброшено к расписанию', 'info');
    await loadTimeOverrides(hall);
    await loadAdminGameTime();
    if (date === getNearestGameDate(hall)) await loadGameTime(hall, date);
    showList();
    showSchedule();
  } catch (_) {
    showToast('Ошибка соединения с сервером', 'error');
  }
}

// ==================== 7.8. ADMIN: ЗАЛЫ ====================

// Перестроить селекты залов (основной и админский) из CONFIG.halls.
// Вызывается после загрузки конфига и после изменения списка залов.
function populateHallSelects() {
  const halls = (CONFIG && CONFIG.halls) || {};
  const ids = Object.keys(halls);
  if (ids.length === 0) return;

  const mainSel = document.getElementById('hallSelect');
  const adminSel = document.getElementById('adminHallSelect');
  const prevMain = mainSel?.value;
  const prevAdmin = adminSel?.value;

  const optionsHtml = ids.map(id =>
    `<option value="${escapeHtml(id)}">${escapeHtml(halls[id].name || id)}</option>`
  ).join('');

  if (mainSel) {
    mainSel.innerHTML = optionsHtml;
    mainSel.value = ids.includes(prevMain) ? prevMain : ids[0];
  }
  if (adminSel) {
    adminSel.innerHTML = optionsHtml;
    adminSel.value = ids.includes(prevAdmin) ? prevAdmin : ids[0];
  }
}

// Переключение табов админ-панели.
function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('adminTabTime').classList.toggle('active', tab === 'time');
  document.getElementById('adminTabHalls').classList.toggle('active', tab === 'halls');
  if (tab === 'halls') loadAdminHalls();
}

// Список залов в админке.
let adminHalls = [];

async function loadAdminHalls() {
  const box = document.getElementById('adminHallsList');
  if (!box) return;
  try {
    const resp = await fetch(`${API_BASE_URL}/api/admin/halls`, { headers: adminHeaders() });
    if (resp.status === 403) { adminLogout(); return; }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    adminHalls = data.halls || [];
    renderAdminHalls();
  } catch (e) {
    box.innerHTML = `<div class="admin-error">Не удалось загрузить залы: ${escapeHtml(e.message)}</div>`;
  }
}

function renderAdminHalls() {
  const box = document.getElementById('adminHallsList');
  if (!box) return;
  if (adminHalls.length === 0) {
    box.innerHTML = '<div class="halls-empty">Залов пока нет</div>';
    return;
  }
  box.innerHTML = adminHalls.map(h => {
    const days = (h.schedule || []).map(s => `${scheduleDayRu(s.day)} ${s.from}:00–${s.to}:00`).join(', ');
    const inactive = h.active ? '' : ' <span class="hall-badge-inactive">скрыт</span>';
    const perPerson = h.perPerson != null ? ` • ${h.perPerson} ₽/чел` : '';
    const hourly = h.prices && h.prices.hourly != null ? `${h.prices.hourly} ₽/час` : '';
    const priceLine = hourly ? `💵 ${escapeHtml(hourly)}${escapeHtml(perPerson)}` : escapeHtml(perPerson.replace(/^ • /, ''));
    return `
      <div class="hall-item${h.active ? '' : ' hall-item-inactive'}">
        <div class="hall-item-main">
          <strong>${escapeHtml(h.name)}</strong>${inactive}
          <div class="hall-item-sched">${days ? escapeHtml(days) : 'график не задан'}</div>
          ${priceLine ? `<div class="hall-item-price">${priceLine}</div>` : ''}
        </div>
        <div class="hall-item-actions">
          <button class="hall-mini-btn" onclick="openHallForm(${h.id})">✎</button>
        </div>
      </div>`;
  }).join('');
}

// Русское название дня недели по английскому коду из расписания.
function scheduleDayRu(day) {
  const map = {
    Monday: 'Пн', Tuesday: 'Вт', Wednesday: 'Ср', Thursday: 'Чт',
    Friday: 'Пт', Saturday: 'Сб', Sunday: 'Вс'
  };
  return map[day] || day;
}

let editingHallId = null; // null = создание нового зала

// Открыть форму зала. hallId = null → новый зал.
function openHallForm(hallId) {
  editingHallId = hallId;
  const hall = hallId == null ? null : adminHalls.find(h => h.id === hallId);
  const wrap = document.getElementById('hallFormWrap');
  const err = document.getElementById('hallFormError');
  if (err) err.textContent = '';

  document.getElementById('hallFormTitle').textContent = hall ? 'Редактирование зала' : 'Новый зал';
  document.getElementById('hallName').value = hall ? hall.name : '';
  document.getElementById('hallPhone').value = hall ? (hall.phone || '') : '';
  document.getElementById('hallResponsible').value = hall ? (hall.responsible || '') : '';
  document.getElementById('hallPriceHourly').value = hall && hall.prices ? (hall.prices.hourly ?? '') : '';
  document.getElementById('hallPerPerson').value = hall && hall.perPerson != null ? hall.perPerson : '';
  updateHallPricePreview();

  // График
  const rows = document.getElementById('hallScheduleRows');
  rows.innerHTML = '';
  const sched = hall && Array.isArray(hall.schedule) ? hall.schedule : [];
  if (sched.length === 0) addScheduleRow();
  else sched.forEach(s => addScheduleRow(s));

  // Кнопка удаления — только для существующего зала.
  document.getElementById('hallDeleteBtn').style.display = hall ? '' : 'none';

  wrap.style.display = '';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeHallForm() {
  document.getElementById('hallFormWrap').style.display = 'none';
  editingHallId = null;
}

// Добавить строку графика: день недели + часы начала/конца.
function addScheduleRow(value) {
  const rows = document.getElementById('hallScheduleRows');
  const v = value || {};
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayOpts = days.map(d =>
    `<option value="${d}"${v.day === d ? ' selected' : ''}>${scheduleDayRu(d)}</option>`
  ).join('');
  const row = document.createElement('div');
  row.className = 'sched-row';
  row.innerHTML = `
    <select class="sched-day">${dayOpts}</select>
    <input type="number" class="sched-from" min="0" max="23" placeholder="21" value="${v.from ?? ''}" />
    <span class="sched-dash">–</span>
    <input type="number" class="sched-to" min="1" max="24" placeholder="23" value="${v.to ?? ''}" />
    <button class="hall-mini-btn sched-del" title="Удалить день">✕</button>`;
  row.querySelector('.sched-del').addEventListener('click', () => row.remove());
  rows.appendChild(row);
}

// Предпросмотр цен: из цены за час считаем 1,5 ч и 2 ч.
function updateHallPricePreview() {
  const box = document.getElementById('hallPricePreview');
  if (!box) return;
  const hourly = Number(document.getElementById('hallPriceHourly').value || 0);
  if (!hourly) { box.textContent = ''; return; }
  const h15 = Math.round(hourly * 1.5);
  const h2 = hourly * 2;
  box.innerHTML = `За 1,5 ч: <strong>${h15} ₽</strong> · за 2 ч: <strong>${h2} ₽</strong>`;
}

// Собрать график из строк формы.
function collectSchedule() {
  const rows = document.querySelectorAll('#hallScheduleRows .sched-row');
  const out = [];
  for (const row of rows) {
    const day = row.querySelector('.sched-day').value;
    const from = Number(row.querySelector('.sched-from').value);
    const to = Number(row.querySelector('.sched-to').value);
    // Пропускаем полностью пустые строки.
    if (!row.querySelector('.sched-from').value && !row.querySelector('.sched-to').value) continue;
    out.push({ day, from, to });
  }
  return out;
}

async function saveHall() {
  const err = document.getElementById('hallFormError');
  if (err) err.textContent = '';

  const body = {
    name: document.getElementById('hallName').value.trim(),
    phone: document.getElementById('hallPhone').value.trim(),
    responsible: document.getElementById('hallResponsible').value.trim(),
    prices: {
      hourly: Number(document.getElementById('hallPriceHourly').value || 0)
    },
    perPerson: document.getElementById('hallPerPerson').value === ''
      ? null : Number(document.getElementById('hallPerPerson').value),
    schedule: collectSchedule()
  };

  const isNew = editingHallId == null;
  const url = isNew
    ? `${API_BASE_URL}/api/admin/halls`
    : `${API_BASE_URL}/api/admin/halls/${encodeURIComponent(
        adminHalls.find(h => h.id === editingHallId)?.sysName || '')}`;

  try {
    const resp = await fetch(url, {
      method: isNew ? 'POST' : 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify(body)
    });
    if (resp.status === 403) { adminLogout(); return; }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (err) err.textContent = data.error || 'Не удалось сохранить зал';
      else showToast(data.error || 'Не удалось сохранить зал', 'error');
      return;
    }
    adminHalls = data.halls || adminHalls;
    showToast(isNew ? 'Зал создан' : 'Зал обновлён', 'success');
    closeHallForm();
    renderAdminHalls();
    await refreshPublicConfig();
  } catch (_) {
    if (err) err.textContent = 'Ошибка соединения с сервером';
  }
}

async function deleteHall() {
  if (editingHallId == null) return;
  const hall = adminHalls.find(h => h.id === editingHallId);
  if (!hall) return;

  const msg = hall.hasGames
    ? `По залу «${hall.name}» уже есть игры. Он будет скрыт (деактивирован), история сохранится. Продолжить?`
    : `Удалить зал «${hall.name}» безвозвратно?`;
  if (!window.confirm(msg)) return;

  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/admin/halls/${encodeURIComponent(hall.sysName)}`,
      { method: 'DELETE', headers: adminHeaders() }
    );
    if (resp.status === 403) { adminLogout(); return; }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      showToast(data.error || 'Не удалось удалить зал', 'error');
      return;
    }
    adminHalls = data.halls || adminHalls;
    showToast(data.deactivated ? 'Зал деактивирован (скрыт)' : 'Зал удалён', 'info');
    closeHallForm();
    renderAdminHalls();
    await refreshPublicConfig();
  } catch (_) {
    showToast('Ошибка соединения с сервером', 'error');
  }
}

// Перечитать публичный конфиг (залы/цены) и перестроить селекты.
async function refreshPublicConfig() {
  const ok = await loadConfig();
  if (ok) {
    populateHallSelects();
    const hall = document.getElementById('hallSelect').value;
    if (hall) {
      await loadTimeOverrides(hall);
      showSchedule();
      showList();
    }
  }
}

// ==================== 8. INIT ====================

window.addEventListener('DOMContentLoaded', async function () {
  // 0. Загружаем конфиг с сервера (цены, телефоны, расписание)
  const configOk = await loadConfig();
  if (!configOk) return; // API недоступен — ошибка уже показана, дальше не идём

  // 0.5. Проверяем соединение сервера с БД (показываем предупреждение при недоступности)
  await checkDbStatus();

  // 0.6. Строим селекты залов из конфига (залы теперь динамические — из БД)
  populateHallSelects();

  // 1. Выбираем ближайший зал (showNearestGame сработает, но isInitialLoad=true → только текст)
  selectNearestHall();

  // 2. Загружаем данные
  await loadFromAPI();

  // 3. Фиксируем дату и обновляем текст
  const hall = document.getElementById('hallSelect').value;
  if (hall) {
    lastHallDateKey = hall + '|' + getNearestGameDate(hall);
    showNearestGame();
  }

  // 4. Загружаем статистику записей, изменения времени и показываем расписание
  await loadSignupStats(hall);
  await loadTimeOverrides(hall);
  showSchedule();

  // 6. Автоподстановка последнего ФИО из localStorage
  const lastName = (() => { try { return localStorage.getItem('ball76_lastName'); } catch (_) { return null; } })();
  if (lastName) {
    const nameInput = document.getElementById('playerName');
    nameInput.value = lastName;
    validatePlayerName();
  }

  // 6.5. Время игры (override расписания): баннер + уведомление игрокам
  if (hall) await loadGameTime(hall, getNearestGameDate(hall));

  // 6.6. Админ: длинное нажатие на версию в футере
  initAdminLongPress();
  updateAdminStatusBar(); // показать баннер, если токен сохранён с прошлого раза

  // 6.7. Слушатели формы админ-панели
  const adminHallSel = document.getElementById('adminHallSelect');
  const adminDateInp = document.getElementById('adminDateInput');
  if (adminHallSel) adminHallSel.addEventListener('change', loadAdminGameTime);
  if (adminDateInp) adminDateInp.addEventListener('change', loadAdminGameTime);
  ['adminStartTime', 'adminNote'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateAdminPreview);
  });
  const adminDurationSel = document.getElementById('adminDuration');
  if (adminDurationSel) adminDurationSel.addEventListener('change', updateAdminPreview);
  // Поле «Цена за час» — живой предпросмотр цен за 1,5 ч и 2 ч.
  const priceHourlyInp = document.getElementById('hallPriceHourly');
  if (priceHourlyInp) priceHourlyInp.addEventListener('input', updateHallPricePreview);

  // 7. Снимаем флаг первой загрузки
  isInitialLoad = false;

  // Часы
  showCurrentDateTime();
  setInterval(showCurrentDateTime, 1000);

  // Автообновление списка раз в 30 секунд (чужие записи становятся видны).
  // silent: true → показывать тост о новых записях (UX5)
  setInterval(async () => {
    if (document.hidden) return;           // не грузим на скрытой вкладке
    try {
      await checkDbStatus();               // обновляем статус соединения с БД
      await loadFromAPI({ silent: true });
    } catch (e) {
      console.error('Ошибка автообновления:', e);
    }
  }, 30000);

  // Обработчики событий
  // UX4: live-валидация на каждом вводе + сохранение на blur
  const nameInput = document.getElementById('playerName');
  nameInput.addEventListener('input', function () {
    validatePlayerName();
    showAutocomplete();
  });
  nameInput.addEventListener('blur', function () {
    validatePlayerName();
    hideAutocomplete();
  });
  nameInput.addEventListener('focus', function () {
    if (this.value.trim()) showAutocomplete();
  });
  nameInput.addEventListener('keydown', function (e) {
    const box = document.getElementById('autocompleteBox');
    const dropdownOpen = box && box.style.display === 'block';

    if (dropdownOpen && e.key === 'ArrowDown') {
      e.preventDefault();
      moveAutocomplete(1);
      return;
    }
    if (dropdownOpen && e.key === 'ArrowUp') {
      e.preventDefault();
      moveAutocomplete(-1);
      return;
    }
    if (dropdownOpen && e.key === 'Enter' && autocompleteIndex >= 0) {
      // Enter выбирает подсказку, а не отправляет форму
      e.preventDefault();
      const active = box.querySelectorAll('.ac-item')[autocompleteIndex];
      if (active) selectAutocomplete(active.dataset.name);
      return;
    }
    if (e.key === 'Escape') {
      hideAutocomplete();
      return;
    }
    if (e.key === 'Enter') addPlayer();
  });
  document.getElementById('hallSelect').addEventListener('change', function () {
    showList();
    Promise.all([
      loadSignupStats(this.value),
      loadTimeOverrides(this.value)
    ]).then(() => showSchedule());
    loadGameTime(this.value, getNearestGameDate(this.value));
  });
  document.getElementById('hallSelect').addEventListener('change', showNearestGame);

  // UX6: ESC закрывает открытую модалку, клик по подложке — тоже
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const teams = document.getElementById('teamsModal');
    if (teams.style.display === 'flex') closeTeamsModal();
    const del = document.getElementById('deleteModal');
    if (del.style.display === 'flex') closeDeleteModal();
    const cl = document.getElementById('changelogModal');
    if (cl.style.display === 'flex') closeChangelogModal();
    const al = document.getElementById('adminLoginModal');
    if (al.style.display === 'flex') closeAdminLogin();
    const ad = document.getElementById('adminModal');
    if (ad.style.display === 'flex') closeAdminPanel();
    const tn = document.getElementById('timeNoticeModal');
    if (tn.style.display === 'flex') closeTimeNotice();
  });

  ['teamsModal', 'deleteModal', 'changelogModal', 'adminLoginModal', 'adminModal', 'timeNoticeModal'].forEach(id => {
    const modal = document.getElementById(id);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) { // клик именно по подложке, не по содержимому
        if (id === 'teamsModal') closeTeamsModal();
        else if (id === 'deleteModal') closeDeleteModal();
        else if (id === 'adminLoginModal') closeAdminLogin();
        else if (id === 'adminModal') closeAdminPanel();
        else if (id === 'timeNoticeModal') closeTimeNotice();
        else closeChangelogModal();
      }
    });
  });

  // UX7: тап/клик по номеру телефона копирует его
  document.addEventListener('click', function (e) {
    const phone = e.target.closest('#displayPhone');
    if (phone && phone.textContent.trim()) {
      copyPhoneToClipboard(phone.textContent.trim());
    }
  });

  // Начальное состояние кнопки «Записаться»
  validatePlayerName();
});
