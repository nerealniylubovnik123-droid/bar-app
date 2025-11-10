# --- Dockerfile ---
FROM node:20-slim

WORKDIR /app

# Устанавливаем зависимости
COPY backend/package*.json ./
RUN npm install --omit=dev

# Копируем бэкенд и фронтенд
COPY backend/. .
COPY public ./public

EXPOSE 8080
CMD ["npm", "start"]
