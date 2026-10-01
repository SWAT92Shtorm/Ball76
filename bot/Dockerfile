FROM node:20-alpine

WORKDIR /app

# Сначала зависимости — для кэширования слоёв
COPY package.json ./
RUN npm install --omit=dev

# Затем код
COPY . .

ENV NODE_ENV=production
ENV TZ=Europe/Moscow

CMD ["node", "index.js"]
