FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  make \
  g++ \
  ffmpeg \
  postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/media/package.json ./apps/media/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm install

COPY . .
RUN npx prisma generate --schema=/app/prisma/schema.postgres.prisma

RUN chmod +x /app/docker/start-all.sh

CMD ["/app/docker/start-all.sh"]
