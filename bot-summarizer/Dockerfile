FROM node:20-alpine

WORKDIR /app

# Корневой CA НУЦ Минцифры — нужен для TLS к GigaChat (Sber).
COPY certs/russiantrustedca.pem /usr/local/share/ca-certificates/russiantrustedca.pem
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/russiantrustedca.pem

COPY package.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "index.js"]
