FROM node:20-alpine

WORKDIR /app

# Сначала зависимости — для кэширования слоёв
COPY package.json ./
RUN npm install --omit=dev

# Затем код
COPY . .

ENV NODE_ENV=production
ENV TZ=Europe/Moscow

# GigaChat использует сертификаты НУЦ Минцифры — добавляем их в доверенные,
# иначе Node падает с "self signed certificate in certificate chain".
ENV NODE_EXTRA_CA_CERTS=/app/certs/russiantrustedca.pem

CMD ["node", "index.js"]
