// server.js
const express = require('express');

const app = express();

// CORS: разрешаем только твой GitHub‑сайт
app.use((req, res, next) => {
  const allowedOrigin = 'https://swat92shtorm.github.io';
  const origin = req.headers.origin;

  if (origin === allowedOrigin) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  // Разрешаем нужные методы и заголовки
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  // Обрабатываем preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

// Тело приложения
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Server works!');
});

app.get('/api/players', (req, res) => {
  res.json({
    playersByHall: { hall1: ['Player 1'], hall2: [] },
    historyByDate: {}
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('✅ Server listening on port', PORT);
});
