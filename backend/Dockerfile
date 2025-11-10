# backend/Dockerfile
FROM node:20-alpine

# Нужны инструменты сборки для better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Ставим зависимости (без dev)
COPY package*.json ./
# На Alpine иногда нет готовых бинарей — принудительно собираем из исходников
ENV npm_config_build_from_source=true
RUN npm ci --omit=dev

# Копируем остальной код
COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/server.cjs"]
# force rebuild 2025-11-10
