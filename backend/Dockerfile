# --- Dockerfile ---
FROM node:20-alpine

WORKDIR /app

# Билд-зависимости для sqlite3 на Alpine
RUN apk add --no-cache python3 make g++ git

# Устанавливаем только по package.json (lock-файл не требуется)
COPY package.json ./
# Если у тебя есть backend/public и прочие статические файлы — они скопируются позже
RUN npm install --omit=dev --no-audit --no-fund

# Копируем остальной код
COPY . .

# Переменные для путей в Railway Volume (переживают деплой)
ENV SQLITE_PATH=/mnt/data/app.sqlite
ENV CATALOG_PATH=/mnt/data/catalog.json
ENV PORT=3000

EXPOSE 3000

# Запуск
CMD ["npm", "start"]
