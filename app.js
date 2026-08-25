/* ============================================================
   Ball76 — клиентская логика
   Модули: config → utils → state → api → schedule → ui → teams → init
   Конфиг (цены, телефоны, расписание, лимиты) приходит с сервера
   через GET /api/config — дублировать его здесь не нужно.
   ============================================================ */

'use strict';

// ==================== 1. CONFIG ====================

// Базовый URL API: динамически по hostname, чтобы один файл работал
// и на GitHub Pages (продакшен), и локально.
const API_BASE_URL =
  location.hostname === 'swat92shtorm.github.io'
    ? 'https://ball76.up.railway.app'   // продакшен (Railway)
    : 'http://localhost:8080';         // локальный Docker

// Заглушка до загрузки /api/config (значения совпадают с серверным APP_CONFIG)
let CONFIG = {
  maxPlayers: 18,
  halls: {}
};

async function loadConfig() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/config`);
    if (!response.ok) throw new Error('Не удалось загрузить конфиг');
    CONFIG = await response.json();
  } catch (err) {
    console.error('Ошибка загрузки конфига, используем заглушку:', err);
  }
}

// Удобные доступы к конфигу зала
function hallName(hallId)      { return CONFIG.halls[hallId]?.name || hallId; }
function hallPhone(hallId)     { return CONFIG.halls[hallId]?.phone || ''; }
function hallResp(hallId)      { return CONFIG.halls[hallId]?.responsible || ''; }
function hallPrice(hallId, durationKey) {
  return CONFIG.halls[hallId]?.prices?.[durationKey] ?? 0;
}
function hallSchedule(hallId)  { return CONFIG.halls[hallId]?.schedule || []; }
function maxPlayers()          { return CONFIG.maxPlayers || 18; }

// ==================== 2. UTILS ====================

// Экранирование HTML-спецсимволов: имена игроков приходят из БД/сети
// и подставляются в innerHTML — без экранирования это XSS.
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
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
let lastNearestDate = null;
let isInitialLoad = true;
let editingIndex = null;        // индекс строки, открытой на редактирование (UX1)
let apiOnline = true;           // статус соединения с API (UX2)

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
      banner.style.cssText = 'margin-bottom: 12px; padding: 10px; border-radius: 5px; background: #501010; border: 1px solid #a03030; color: #ffe0e0; font-size: 13px;';
      document.querySelector('main').prepend(banner);
    }
    banner.textContent = '⚠️ Не удалось подключиться к серверу. Показаны последние известные данные.';
    banner.style.display = 'block';
  } else if (banner) {
    banner.style.display = 'none';
  }
}

async function loadFromAPI({ silent = false } = {}) {
  // UX1: если открыт инпут редактирования — не перерисовываем список,
  // чтобы не сжечь введённое имя
  if (editingIndex !== null && !silent) {
    return;
  }

  const prevPlayers = (playersByHall[document.getElementById('hallSelect').value] || []).slice();

  try {
    // 1. Игроки текущей игры выбранного зала
    const hall = document.getElementById('hallSelect').value;
    const dateStr = getNearestGameDate(hall);
    const response = await fetch(
      `${API_BASE_URL}/api/players/${hall}/${dateStr}`
    );

    if (!response.ok) throw new Error('Не удалось загрузить участников');
    const data = await response.json();
    playersByHall = data.playersByHall || { hall1: [], hall2: [] };

    // 2. История записей из базы (все игры)
    const historyResponse = await fetch(`${API_BASE_URL}/api/history`);
    if (!historyResponse.ok) throw new Error('Не удалось загрузить историю');
    const historyData = await historyResponse.json();
    historyByDate = historyData.historyByDate || {};

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

    // UX5: тост о новых записях (только при фоновом обновлении,
    // не при явном действии пользователя)
    if (silent) {
      const current = playersByHall[document.getElementById('hallSelect').value] || [];
      const added = current.filter(n => !prevPlayers.includes(n));
      if (added.length > 0) {
        showToast(`Новые записи: ${added.join(', ')}`, 'info', 5000);
      }
    }
  } catch (err) {
    console.error('Ошибка при запросе API:', err);
    // UX2: НЕ сбрасываем данные — держим последний успешный снимок
    setApiStatus(false);
    return;
  }

  updatePlayersList();
  showList();
}

// Добавить игрока
async function addPlayer() {
  const input = document.getElementById('playerName');
  const error = document.getElementById('playerNameError');
  const name = input.value.trim();
  const words = name.split(/\s+/).filter(w => w.length > 0);

  if (!name || words.length < 3) {
    validatePlayerName();
    return;
  }

  const hall = document.getElementById('hallSelect').value;
  if (!hall) {
    showToast('Сначала выберите зал', 'error');
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
      <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
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
    resetInputStyles(input, error);
    showList();
    updatePlayersList();

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
  if (parts.length < 3) {
    showToast('ФИО должно состоять из трёх слов: Фамилия Имя Отчество', 'error');
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

  // При смене даты — перезагрузить список
  if (g && g.date !== lastNearestDate) {
    lastNearestDate = g.date;
    try {
      await loadFromAPI();
    } catch (e) {
      console.error('Ошибка загрузки в showNearestGame:', e);
    }
  }
}

// График игр выбранного зала
function showSchedule() {
  const hall = document.getElementById('hallSelect').value;
  const container = document.getElementById('scheduleContainer');
  const content = document.getElementById('scheduleContent');

  container.style.display = 'none';
  content.innerHTML = '';

  if (!CONFIG.halls[hall]) return;

  const h = CONFIG.halls[hall];
  const commonInfo = `
    <div style="margin-bottom: 15px; padding: 12px; background: #1a1a1a; border-radius: 6px; border: 1px solid #505050; font-size: 14px; line-height: 1.3;">
      <div style="font-weight: 600; color: #a0e0ff; margin-bottom: 6px;">📋 Общая информация по залу</div>
      <div style="color: #e0e0e0; font-weight: 500;">
        Стоимость: <span style="color: #a0e0ff; font-weight: 600;">${hallPrice(hall, 'full')} ₽</span>
        | Мин: <span style="color: #a0e0ff; font-weight: 600;">10</span> чел.
        | Макс: <span style="color: #a0e0ff; font-weight: 600;">${maxPlayers()}</span> чел.
      </div>
    </div>
  `;

  const slots = h.schedule.map(item => `
    <div style="margin-bottom: 10px; padding: 12px; border-radius: 4px; background: #222; border: 1px solid #404040;">
      <div style="font-weight: bold; color: #a0e0ff; font-size: 15px;">
        📅 ${dayNamesRU[item.day]}, ${item.from}:00–${item.to}:00
      </div>
    </div>
  `).join('');

  container.style.display = 'block';
  content.innerHTML = commonInfo + slots;
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

// Подсчёт записей игрока в зале (ТОЛЬКО ПРОШЕДШИЕ)
function countPlayerVisits(historyByDate, playerName, hall) {
  const now = getMSKNow();
  let count = 0;
  for (const dateStr in historyByDate) {
    const players = historyByDate[dateStr][hall];
    if (!players) continue;
    // Дата игры — московская, игра считается прошедшей, если её дата+21:00 < сейчас
    const sessionDate = new Date(dateStr + 'T21:00:00');
    if (sessionDate < now && players.some(p => p === playerName)) {
      count++;
    }
  }
  return count;
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
    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 20px; font-weight: 600; color: #ffffff; margin-bottom: 14px; padding-bottom: 6px; border-bottom: 1px solid #404040;">
      <span>Все записавшиеся в <span style="color: #a0e0ff;">${escapeHtml(hallText)}</span></span>
      <span style="cursor: pointer; color: red;" title="Сформировать команды" onclick="openTeamsModal()">🎲</span>
    </div>
    ${resp ? `
      <div style="font-size: 13px; margin-bottom: 14px; color: #b0ffa0;">
        Ответственный: ${escapeHtml(resp)}
      </div>
    ` : ''}
  `;

  if (players.length === 0) {
    result.innerHTML += '<p>Список пока пуст.</p>';
  } else {
    const list = players.map((name, i) => {
      const idx = i + 1;
      const isLimited = idx <= maxPlayers();
      const nameStyle = isLimited ? '' : 'color: red;';
      return `
        <div class="playerLine" id="playerLine${i}" style="${nameStyle}">
          <div class="playerName">
            <span style="${nameStyle}">${idx}. ${escapeHtml(name)}
              <span style="color: #a0e0ff; font-size: 12px; float: right; margin-left: auto;">${countPlayerVisits(historyByDate, name, hall)} <span style="color: #90ff90;"> +1</span></span>
            </span>
            <input type="text" id="nameEdit${i}" value="${escapeHtml(name)}" style="display: none; width: 250px; padding: 2px;" />
          </div>
          <div class="icons">
            <span onclick="startEdit(${i})" style="cursor: pointer; margin-right: 6px;">✎</span>
            <span onclick="submitEdit(${i})" style="display: none; cursor: pointer; margin-right: 6px; color: green;">✔</span>
            <span onclick="cancelEdit(${i})" style="display: none; cursor: pointer; margin-right: 6px; color: gray;">✖</span>
            <span onclick="openDeleteModal(${i})" style="cursor: pointer; color: red;" title="Удалить">🗑️</span>
          </div>
        </div>
      `;
    }).join('');
    result.innerHTML += list;
  }

  // Индикатор заполненности
  const perc = Math.min(100, (players.length / maxPlayers()) * 100);
  const barColor = players.length < 10 ? '#c62828' : '#2e7d32';

  result.innerHTML += `
    <div style="margin-top: 12px; font-size: 13px; color: #b0b0b0;">
      Заполненность:
      <span style="color: #ffffff;">${players.length} / ${maxPlayers()} человек</span>
      <div style="margin-top: 4px; height: 8px; background: #444; border-radius: 4px; overflow: hidden;">
        <div style="height: 100%; width: ${perc}%; background: ${barColor}; border-radius: 4px; transition: width 0.3s ease;"></div>
      </div>
    </div>
  `;

  renderPricingRow(hall, players.length);
  showHistoryTable();
}

// Строка «стоимость к оплате»
function renderPricingRow(hall, playersCount) {
  const priceElem = document.getElementById('pricingRow');
  const durationSelect = document.getElementById('durationSelect');
  const durationKey = durationSelect ? durationSelect.value : 'full';
  const price = hallPrice(hall, durationKey);
  const durationText = durationKey === 'full' ? '2 часа' : durationKey === 'short' ? '1 час 30 мин' : '';

  if (price > 500 && playersCount > 0) {
    const activeCount = Math.min(maxPlayers(), playersCount);
    const perPerson = (price / activeCount).toFixed(2);
    const isUnder10 = playersCount < 10;
    const mainBg = isUnder10 ? '#501010' : '#1a4b1a';
    const borderCol = isUnder10 ? '#a03030' : '#006633';
    const phoneBg = isUnder10 ? '#501010' : '#224422';
    const phone = hallPhone(hall);

    priceElem.style.background = mainBg;
    priceElem.style.borderColor = borderCol;
    priceElem.innerHTML = `
      <div style="font-size: 13px; margin-bottom: 4px;">Стоимость зала: ${price} ₽</div>
      <div style="font-size: 13px; margin-bottom: 4px;">Время аренды: ${durationText}</div>
      <div style="font-size: 13px;">Оплачивать будут ${activeCount} человек (${activeCount} в пределах лимита)</div>
      <div style="font-size: 13px; margin-top: 4px;"><strong>Каждому нужно заплатить: ${perPerson} ₽</strong></div>
      <div style="margin-top: 10px; padding: 8px 10px; background: ${phoneBg}; border-radius: 4px; border: 1px solid #336633; font-size: 13px; color: #e0ffe0;">
        Для оплаты переведите деньги на телефон:
        <br />
        <span style="color: #ffffff; font-weight: bold; margin: 0 4px; cursor: pointer; text-decoration: underline dotted;" id="displayPhone" title="Нажмите, чтобы скопировать">${escapeHtml(phone)}</span>
        <button
          onclick="copyPhoneToClipboard('${escapeHtml(phone)}')"
          style="margin-left: 6px; padding: 0; width: 20px; height: 20px; border: none; background: transparent; color: #a0e0ff; font-size: 15px; cursor: pointer;"
          title="Копировать телефон">📋</button>
      </div>
    `;
  } else {
    priceElem.style.background = '#1a4b1a';
    priceElem.style.borderColor = '#404040';
    priceElem.innerHTML = `
      Стоимость зала: ${price} ₽.<br>
      Для этого зала не производится деление на участников или участников нет.
    `;
  }
}

// История записей в виде карточек под списком участников
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

  let html = `
    <h3 style="color: #a0e0ff; margin-top: 14px; margin-bottom: 8px; font-size: 16px;">
      История записей в зале ${escapeHtml(hallName(hall))} по датам
    </h3>
    <div style="display: flex; flex-direction: column; gap: 10px;">
  `;

  entries.forEach(entry => {
    html += `
      <div style="padding: 10px; border-radius: 4px; background: #222; border: 1px solid #404040; font-size: 13px; color: #e0e0e0;">
        <div style="font-weight: 600; color: #a0e0ff; margin-bottom: 4px;">${entry.date}</div>
        <div style="line-height: 1.5;">${entry.players.map(escapeHtml).join(', ')}</div>
      </div>
    `;
  });

  html += '</div>';
  historyTableContainer.innerHTML = html;
}

// Datalist с подсказками ФИО
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

function updatePlayersList() {
  const list = document.getElementById('playersList');
  list.innerHTML = '';
  collectAllNamesFromHistory().forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    list.appendChild(option);
  });
}

// Валидация ФИО. UX4: вызывается на каждом input (live), а не только на blur.
// Пустое поле — нейтральное состояние; непустое с <3 слов — ошибка.
function validatePlayerName() {
  const input = document.getElementById('playerName');
  const error = document.getElementById('playerNameError');
  const btn = document.querySelector('button[onclick="addPlayer()"]');
  const name = input.value.trim();
  const words = name.split(/\s+/).filter(w => w.length > 0);

  const invalid = name.length > 0 && words.length < 3;

  if (invalid) {
    input.style.borderColor = '#ffb347';
    input.style.backgroundColor = '#3a2f1a';
    input.style.color = '#ffe8c0';
    error.style.display = 'block';
  } else {
    resetInputStyles(input, error);
  }

  // Кнопка активна, только когда ФИО введено полностью
  if (btn) {
    btn.disabled = btn.dataset.loading === '1' || !name || words.length < 3;
    btn.title = (!name || words.length < 3) ? 'Введите Фамилию Имя Отчество' : '';
  }
}

function resetInputStyles(input, error) {
  input.style.borderColor = '#404040';
  input.style.backgroundColor = '#2d2d2d';
  input.style.color = '#f0f0f0';
  error.style.display = 'none';
}

// Inline-редактирование имени
function startEdit(index) {
  const line = document.getElementById(`playerLine${index}`);
  const span = line.querySelector('.playerName span');
  const input = document.getElementById(`nameEdit${index}`);

  const startIcon = line.querySelector(`span[onclick="startEdit(${index})"]`);
  const submitIcon = line.querySelector(`span[onclick="submitEdit(${index})"]`);
  const cancelIcon = line.querySelector(`span[onclick="cancelEdit(${index})"]`);

  span.style.display = 'none';
  input.style.display = 'inline-block';
  input.focus();
  input.select();

  startIcon.style.display = 'none';
  submitIcon.style.display = 'inline-block';
  cancelIcon.style.display = 'inline-block';

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
    <p style="margin-bottom: 8px; font-weight: 500;">Всего игроков: <strong>${players.length}</strong></p>
    <p style="margin-bottom: 12px; font-weight: 500;">Сформировано команд: <strong>${numTeams}</strong></p>
  `;

  teams.forEach((team, idx) => {
    const items = team.map((name, i) => {
      const extraStyle = i === 5 ? 'margin-top: 8px;' : '';
      return `<li class="team-player-item" style="margin: 2px 0; ${extraStyle}">${escapeHtml(name)}</li>`;
    }).join('');

    inner += `
      <div class="team-card">
        <div class="team-title">Команда ${idx + 1} (${team.length} человек)</div>
        <div class="team-main">
          <ol class="team-main-ol" style="margin: 0; padding-left: 20px; list-style-type: decimal;">
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
  await loadConfig();

  // 1. Выбираем ближайший зал (showNearestGame сработает, но isInitialLoad=true → только текст)
  selectNearestHall();

  // 2. Загружаем данные
  await loadFromAPI();

  // 3. Фиксируем дату и обновляем текст
  const hall = document.getElementById('hallSelect').value;
  if (hall) {
    lastNearestDate = getNearestGameDate(hall);
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
      await loadFromAPI({ silent: true });
    } catch (e) {
      console.error('Ошибка автообновления:', e);
    }
  }, 30000);

  // Обработчики событий
  // UX4: live-валидация на каждом вводе + сохранение на blur
  document.getElementById('playerName').addEventListener('input', validatePlayerName);
  document.getElementById('playerName').addEventListener('blur', validatePlayerName);
  document.getElementById('playerName').addEventListener('keydown', function (e) {
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
