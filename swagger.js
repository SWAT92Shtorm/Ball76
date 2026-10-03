const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Ball76 API — Запись на баскетбол в Ярославле',
      description: `
API для управления записью на баскетбол в залах ЛОКОМОТИВ и АТЛАНТ.

## Основные сущности
- **Игрок (player)** — ФИО, уникальное по всей базе
- **Игра (game)** — зал + дата
- **Запись (game_player)** — связь игрока с игрой

## Ограничения
- Максимум игроков на одну игру: **18**
- Минимум для игры: **10** человек
- Даты в формате **YYYY-MM-DD** (московское время)
`,
      contact: {
        name: 'Ball76'
      }
    },
    servers: [
      { url: 'https://ball76.duckdns.org', description: 'Продакшен (CloudCore)' },
      { url: 'http://localhost:8080', description: 'Локальный сервер' }
    ],
    tags: [
      { name: 'Config', description: 'Конфигурация приложения' },
      { name: 'Status', description: 'Статус сервиса' },
      { name: 'Players', description: 'Управление игроками и записями' },
      { name: 'History', description: 'История записей' },
      { name: 'Games', description: 'Время игр и отклонения от расписания' },
      { name: 'Admin', description: 'Администрирование: вход, залы и график' }
    ]
  },
  apis: ['./server.js']
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = { swaggerSpec, options };
