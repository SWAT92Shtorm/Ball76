// server.js
const express = require('express');

console.log('✈️ Server starting...');

const app = express();
app.use(express.json());

// Простой маршрут, чтобы проверить
app.get('/api/players', (req, res) => {
  console.log('🟢 GET /api/players');
  res.json({
    playersByHall: { hall1: ['Player 1'], hall2: [] },
    historyByDate: {}
  });
});

const PORT = process.env.PORT || 3000;
console.log('🚀 Port:', PORT);

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
