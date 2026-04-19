// server.js
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

console.log('1. Импорт модулей завершён');

const app = express();
console.log('2. app создан');

app.use(cors({
  origin: [
    'https://swat92shtorm.github.io',
    'https://seleniumwebdriverdq-production.up.railway.app'
  ]
}));
console.log('3. CORS включён');

app.use(express.json());
console.log('4. express.json() включён');

// Путь к файлу с данными
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'players.json');

console.log('5. DATA_DIR:', DATA_DIR);
console.log('6. DATA_FILE:', DATA_FILE);

// Создать папку data, если её нет
if (!fs.existsSync(DATA_DIR)) {
  console.log('7. Создаю папку data...');
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Создать players.json, если его нет
if (!fs.existsSync(DATA_FILE)) {
  console.log('8. Создаю players.json...');
  const emptyData = {
    playersByHall: { hall1: [], hall2: [] },
    historyByDate: {}
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(emptyData, null, 2), 'utf8');
}

// Загрузка текущих данных (GET /api/players)
app.get('/api/players', (req, res) => {
  console.log('=== GET /api/players ===');
  console.log('DATA_FILE:', DATA_FILE);

  try {
    if (!fs.existsSync(DATA_FILE)) {
      console.log('Файл не существует, создаю пустой...');
      const emptyData = {
        playersByHall: { hall1: [], hall2: [] },
        historyByDate: {}
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(emptyData, null, 2), 'utf8');
    }

    const data = fs.readFileSync(DATA_FILE, 'utf8');
    console.log('Содержимое файла:', data);

    const json = JSON.parse(data);
    res.json(json);

  } catch (err) {
    console.error('Ошибка при чтении/парсинге:', err.message);
    res.status(500).json({ error: 'Failed to read players.json' });
  }
});

// Сохранение игроков и истории (POST /api/savePlayers)
app.post('/api/savePlayers', (req, res) => {
  console.log('=== POST /api/savePlayers ===');
  console.log('BODY ПРИШЁЛ:', req.body);

  const { playersByHall, historyByDate } = req.body;

  const data = {
    playersByHall: playersByHall || { hall1: [], hall2: [] },
    historyByDate: historyByDate || {}
  };

  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    res.json({ success: true, message: 'Players saved' });
  } catch (err) {
    console.error('Ошибка при записи файла:', err.message);
    res.status(500).json({ error: 'Failed to save players.json' });
  }
});

// Порт и запуск
const PORT = process
