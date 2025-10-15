# Dockerfile — для Railway / CommonJS

FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Railway автоматически подставит PORT
ENV NODE_ENV=production
ENV SQLITE_PATH=/mnt/data/app.sqlite

CMD ["node", "src/server.cjs"]
