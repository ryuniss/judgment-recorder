# 어디서나 같은 방식으로 띄우기 위한 컨테이너 (Render·Railway·Fly.io·사내 서버 등)
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=8787 DATABASE_PATH=/data/p3.sqlite3
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server.js"]
