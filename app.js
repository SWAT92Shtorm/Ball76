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
// Дефолтный адрес туннеля (из серверного APP_CONFIG.apiUrl).
// Если пользователь не вводил адрес вручную — используем этот.
const DEFAULT_TUNNEL_URL = 'https://ball76api.loca.lt';

function detectApiBase() {
  const host = location.hostname;

  // Страница открыта через туннель → API на том же адресе.
  // Сохраняем, чтобы при переходе на GitHub Pages-копию не потерять.
  if (/\.loca\.lt$/.test(host)) {
    const base = location.origin;
    try { localStorage.setItem('ball76_api', base); } catch (_) {}
    return base;
  }

  const saved = localStorage.getItem('ball76_api');
  if (saved) {
    return saved.replace(/\/+$/, '');
  }

  // GitHub Pages без сохранённого туннеля — дефолт из серверного конфига.
  // Локальная разработка — Docker на localhost.
  if (host === 'swat92shtorm.github.io') return DEFAULT_TUNNEL_URL;
  return 'http://localhost:8080';
}

let API_BASE_URL = detectApiBase();

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
    const t = setTimeout(() => ctrl.abort(), 5000);
    const response = await fetch(`${API_BASE_URL}/api/config`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    CONFIG = await response.json();
    return true;
  } catch (err) {
    // Мёртвый/неверный туннель — очищаем и показываем модалку с ошибкой.
    if (/\.loca\.lt$|localhost|127\.0\.0\.1/.test(API_BASE_URL)) {
      try { localStorage.removeItem('ball76_api'); } catch (_) {}
      openTunnelModal(`⚠️ API (${API_BASE_URL}) недоступен: ${err.message}. Введите правильный адрес:`);
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
        <input type="text" id="tunnelUrlInput" class="tunnel-modal-input"
               placeholder="https://xxx.loca.lt" autocomplete="off" spellcheck="false">
        <button id="tunnelModalBtn" class="tunnel-modal-btn">Подключить</button>
      </div>
      <p class="tunnel-modal-hint">Адрес выдаёт команда <code>./tunnel.sh</code></p>
    </div>`;
  main.prepend(div);
  _tunnelModalEl = div;
  setTimeout(() => document.getElementById('tunnelUrlInput')?.focus(), 100);
  document.getElementById('tunnelUrlInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') connectTunnel();
  });
  document.getElementById('tunnelModalBtn').addEventListener('click', connectTunnel);
}

function closeTunnelModal() {
  if (_tunnelModalEl) { _tunnelModalEl.remove(); _tunnelModalEl = null; }
}

function setTunnelModalError(msg) {
  const el = document.getElementById('tunnelModalMsg');
  if (el) { el.textContent = msg; el.style.color = '#e74c3c'; }
}

async function connectTunnel() {
  const input = document.getElementById('tunnelUrlInput');
  let url = (input?.value || '').trim().replace(/\/+$/, '');
  if (!url) { setTunnelModalError('Введите адрес туннеля'); return; }
  // Автодополнение протокола
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  // Базовая валидация
  try { new URL(url); } catch { setTunnelModalError('Некорректный URL. Пример: https://ball76api.loca.lt'); return; }

  const btn = document.getElementById('tunnelModalBtn');
  btn.disabled = true;
  btn.textContent = 'Проверка…';

  // Проверяем что API отвечает ПЕРЕД сохранением
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(`${url}/api/status`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    // Успех — сохраняем и перезагружаем
    try { localStorage.setItem('ball76_api', url); } catch (_) {}
    location.reload();
  } catch (err) {
    // Ошибка — показываем в модалке, НЕ перезагружаем
    setTunnelModalError(`⚠️ ${url} недоступен: ${err.message}. Попробуйте другой адрес.`);
    btn.disabled = false;
    btn.textContent = 'Подключить';
    input.select();
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

// Копировать телефон в буфер
async function copyPhoneToClipboard(phone) {
  try {
    await navigator.clipboard.writeText(phone);
    showToast('Телефон скопирован', 'success', 2000);
  } catch (err) {
    console.error('Не удалось скопировать телефон:', err);
    showToast('Не удалось скопировать телефон', 'error');
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
    const response = await fetch(`${API_BASE_URL}/api/status`);
    const data = await response.json();
    const online = !!data.db && response.ok;
    if (online !== dbOnline) {
      dbOnline = online;
      updateDbWarning();
    }
  } catch (err) {
    // Сервер не ответил вообще — считаем БД недоступной
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
        `${API_BASE_URL}/api/players/${currentHall}/${dateStr}`
      );
      if (!response.ok) throw new Error('Не удалось загрузить участников');
      playersData = await response.json();
    } else {
      playersData = { playersByHall };
    }
    playersByHall = playersData.playersByHall || { hall1: [], hall2: [] };

    // 2. История записей из базы (все игры)
    const historyResponse = await fetch(`${API_BASE_URL}/api/history`);
    if (!historyResponse.ok) throw new Error('Не удалось загрузить историю');
    const historyData = await historyResponse.json();
    historyByDate = historyData.historyByDate || {};

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
        (dateData[hallId] || []).forEach(name => {
          if (name) allNames.add(name.trim());
        });
      }
    });
    playerNames = Array.from(allNames);

    setApiStatus(true);
  } catch (err) {
    console.error('Ошибка при запросе API:', err);
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
      headers: { 'Content-Type': 'application/json' },
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

    input.value = '';
    hideAutocomplete();
    resetInputStyles(input, error);
    showList();

    await loadFromAPI();
    showToast(`${name} записан на игру`, 'success');
  } catch (err) {
    console.error('Ошибка при добавлении через API:', err);
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
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }
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
    showToast(`«${name}» удалён из списка`, 'success');
  } catch (err) {
    console.error('Ошибка при удалении через API:', err);
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentName: oldName, newName })
    });

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
    showToast(`Игрок переименован в «${newName}»`, 'success');
  } catch (err) {
    console.error('Ошибка при редактировании через API:', err);
    showToast(err.message || 'Не удалось отредактировать игрока', 'error');
  }
}

// ==================== 5. SCHEDULE (ближайшая игра) ====================

const dayNamesRU = {
  Monday: 'понедельник',
  Tuesday: 'вторник',
  Wednesday: 'среда',
  Thursday: 'четверг',
  Friday: 'пятница',
  Saturday: 'суббота',
  Sunday: 'воскресенье'
};

function getDayCode(dayName) {
  const map = {
    Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4,
    Friday: 5, Saturday: 6, Sunday: 7
  };
  return map[dayName] || 0;
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

  return {
    date: `${y}-${m}-${day}`,
    dayDiff: nearest.dayDiff,
    text: `Ближайшая игра: ${weekday}, ${dayNum} ${month}, в ${nearest.from}:00`
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
    info.textContent = 'Ближайшая игра: не выбран зал';
    return;
  }

  const g = getNearestGame(hall);
  info.textContent = g ? g.text : 'Ближайшая игра: не найдено';

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
    const isToday = code === todayCode;
    const isNearest = nearest && getDayCode(nearest.day) === code;
    const classes = ['sched-cell'];
    if (isToday) classes.push('today');
    if (isNearest) classes.push('nearest');

    const slotHtml = slots.length
      ? slots.map(s => `<div class="sched-slot">${s.from}:00–${s.to}:00</div>`).join('')
      : '<div class="sched-off">—</div>';

    return `
      <div class="${classes.join(' ')}">
        <div class="sched-day-letter">${dayLetters[i]}</div>
        <div class="sched-day-name">${dayNamesRU[slots[0]?.day] || ''}</div>
        ${slotHtml}
        ${isNearest ? '<div class="sched-badge">ближайшая</div>' : ''}
      </div>
    `;
  }).join('');

  const fullPrice = hallPrice(hall, 'full');
  const shortPrice = hallPrice(hall, 'short');
  const perPersonFixed = h.perPerson;
  let priceText;
  if (perPersonFixed) {
    // Фиксированная цена с человека (АТЛАНТ): аренда не делится
    priceText = `${perPersonFixed} ₽ с человека (аренда ${fullPrice} ₽)`;
  } else if (fullPrice > 0) {
    priceText = `${fullPrice} ₽ / 2 ч${shortPrice > 0 && shortPrice !== fullPrice ? `, ${shortPrice} ₽ / 1,5 ч` : ''} — делится на участников`;
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
    const players = historyByDate[dateStr][hall];
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
            <span class="${overLimitCls.trim()}">${idx}. ${escapeHtml(name)}
              <span class="visit-count">${getPlayerVisits(name)} <span class="visit-plus">+1</span></span>
            </span>
            <input type="text" id="nameEdit${i}" class="player-name-edit" value="${escapeHtml(name)}" />
          </div>
          <div class="icons">
            <span class="icon-btn icon-edit" onclick="startEdit(${i})">✎</span>
            <span class="icon-btn icon-save" onclick="submitEdit(${i})">✔</span>
            <span class="icon-btn icon-cancel" onclick="cancelEdit(${i})">✖</span>
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

// Строка «стоимость к оплате».
// Два режима (настраивается полем perPerson в конфиге зала):
//  - perPerson задан (АТЛАНТ): фиксированная сумма с человека, аренда
//    всегда 6000 ₽ и НЕ делится на количество участников;
//  - perPerson не задан (ЛОКОМОТИВ): стоимость аренды делится на
//    всех записавшихся (в пределах лимита maxPlayers).
function renderPricingRow(hall, playersCount) {
  const priceElem = document.getElementById('pricingRow');
  const durationSelect = document.getElementById('durationSelect');
  const durationKey = durationSelect ? durationSelect.value : 'full';
  const price = hallPrice(hall, durationKey);
  const durationText = durationKey === 'full' ? '2 часа' : durationKey === 'short' ? '1 час 30 мин' : '';
  const perPersonFixed = CONFIG.halls[hall]?.perPerson; // undefined → режим деления
  const phone = hallPhone(hall);

  // Единый стиль для всех залов: предупреждение «меньше минимума»
  // показывается всегда, когда есть хотя бы один участник и их < 10.
  const isUnder10 = playersCount > 0 && playersCount < 10;
  priceElem.classList.toggle('pricing-warn', isUnder10);

  // Единая формулировка для обоих залов: «Каждому нужно заплатить: N ₽».
  // Разница только в том, как считается N:
  //  - АТЛАНТ (perPerson задан): фиксированная сумма, не зависит от числа игроков;
  //  - ЛОКОМОТИВ: стоимость аренды делится на всех записавшихся.
  let perPersonAmount;
  let payNote;
  if (perPersonFixed) {
    perPersonAmount = String(perPersonFixed);
    payNote = 'Сумма фиксированная, не делится на участников.';
  } else if (playersCount > 0) {
    const activeCount = Math.min(maxPlayers(), playersCount);
    perPersonAmount = (price / activeCount).toFixed(2);
    payNote = `Оплачивать будут ${activeCount} чел. (в пределах лимита ${maxPlayers()}).`;
  } else {
    perPersonAmount = null;
    payNote = 'Участников пока нет — запишитесь первым!';
  }

  const pricingLines = `
    <div class="pricing-line">Стоимость аренды зала: ${price} ₽${perPersonFixed ? ' (фиксированно)' : ''}</div>
    <div class="pricing-line">Время аренды: ${durationText}</div>
    <div class="pricing-line">${payNote}</div>
    ${perPersonAmount !== null
      ? `<div class="pricing-amount"><strong>Каждому нужно заплатить: ${perPersonAmount} ₽</strong></div>`
      : ''}
  `;

  priceElem.innerHTML = `
    ${pricingLines}
    <div class="pricing-registered${isUnder10 ? ' under-min' : ''}">
      Записалось: ${playersCount} чел.${isUnder10 ? ' ⚠️ Меньше минимума (10) — игра может не состояться!' : ''}
    </div>
    <div class="phone-block${isUnder10 ? ' phone-block-warn' : ''}">
      Для оплаты переведите деньги на телефон:
      <br />
      <span class="phone-number" id="displayPhone" title="Нажмите, чтобы скопировать">${escapeHtml(phone)}</span>
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

// История записей в виде карточек-таймлайна под списком участников
function showHistoryTable() {
  const hall = document.getElementById('hallSelect').value;
  const historyTableContainer = document.getElementById('historyTableContainer');
  historyTableContainer.innerHTML = '';
  historyTableContainer.style.display = 'none';

  if (!hall) return;

  // Записи только для этого зала, последние 2 по дате
  const entries = Object.keys(historyByDate)
    .map(dateStr => ({ date: dateStr, players: historyByDate[dateStr][hall] || [] }))
    .filter(e => e.players.length > 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 2);

  if (entries.length === 0) return;

  historyTableContainer.style.display = 'block';

  const cards = entries.map((entry, i) => {
    const label = i === 0 ? 'предыдущая игра' : 'игра до неё';
    const chips = entry.players.map(p => `<span class="hist-chip">${escapeHtml(p)}</span>`).join('');
    return `
      <div class="hist-card">
        <div class="hist-head">
          <div class="hist-date">
            <span class="hist-date-main">${formatShortDate(entry.date)}</span>
            <span class="hist-date-sub">${label}</span>
          </div>
          <div class="hist-count">${entry.players.length} чел.</div>
        </div>
        <div class="hist-chips">${chips}</div>
      </div>
    `;
  }).join('');

  historyTableContainer.innerHTML = `
    <h3 class="hist-title">📜 История записей — ${escapeHtml(hallName(hall))}</h3>
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
      (dateData[hallId] || []).forEach(name => {
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

// ==================== 8. INIT ====================

window.addEventListener('DOMContentLoaded', async function () {
  // 0. Загружаем конфиг с сервера (цены, телефоны, расписание)
  const configOk = await loadConfig();
  if (!configOk) return; // API недоступен — ошибка уже показана, дальше не идём

  // 0.5. Проверяем соединение сервера с БД (показываем предупреждение при недоступности)
  await checkDbStatus();

  // 1. Выбираем ближайший зал (showNearestGame сработает, но isInitialLoad=true → только текст)
  selectNearestHall();

  // 2. Загружаем данные
  await loadFromAPI();

  // 3. Фиксируем дату и обновляем текст
  const hall = document.getElementById('hallSelect').value;
  if (hall) {
    lastHallDateKey = hall + '|' + getNearestGameDate(hall);
    document.getElementById('nearestGameInfo').textContent = getNearestGameText(hall);
  }

  // 4. Показываем расписание
  showSchedule();

  // 5. Длительность по количеству игроков (только при первом открытии)
  const durationSelect = document.getElementById('durationSelect');
  const currentPlayers = playersByHall[hall]?.length || 0;
  durationSelect.value = currentPlayers >= 15 ? 'full' : 'short';

  // 6. Снимаем флаг первой загрузки
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
    showSchedule();
  });
  document.getElementById('durationSelect').addEventListener('change', function () {
    showList();
  });
  document.getElementById('hallSelect').addEventListener('change', showNearestGame);

  // UX6: ESC закрывает открытую модалку, клик по подложке — тоже
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const teams = document.getElementById('teamsModal');
    if (teams.style.display === 'flex') closeTeamsModal();
    const del = document.getElementById('deleteModal');
    if (del.style.display === 'flex') closeDeleteModal();
  });

  ['teamsModal', 'deleteModal'].forEach(id => {
    const modal = document.getElementById(id);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) { // клик именно по подложке, не по содержимому
        if (id === 'teamsModal') closeTeamsModal();
        else closeDeleteModal();
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
