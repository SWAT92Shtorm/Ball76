// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');

console.log('✈️ Server starting...');

const app = express();
app.use(express.json());

// Путь к файлу (даже если папки нет — сервер всё равно стартует)
const DATA_FILE = path.join(process.cwd(), 'data', 'players.json');

// GET /api/players (даже без JSON‑файла)
app.get('/api/players', (req, res) => {
  console.log('🟢 GET /api/players');
  res.json({
    playersByHall: { hall1: ['Demo Player'], hall2: [] },
    historyByDate: {}
  });
});

const PORT = process.env.PORT || 3000;
console.log('🚀 Port:', PORT);

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
