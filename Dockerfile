# ── 构建阶段：装全量依赖，编译前端(dist/)与服务端(dist-server/) ──
# Node 24：node:sqlite 需 22+，本项目锁 24 避免 experimental flag 波动。
FROM node:24-slim AS builder
WORKDIR /app

# 先拷贝清单，利用层缓存：依赖不变则跳过重装
COPY package.json package-lock.json ./
RUN npm ci

# 拷贝源码与构建配置，产出前端 dist/ 与服务端 dist-server/
COPY . .
RUN npm run build \
 && npm run build:server

# ── 运行阶段：仅装运行时依赖，拷入构建产物 ──
# node:sqlite 为 Node 内置，零原生编译；运行时依赖仅 hono/@hono/node-server/
# node-cron/socks/undici/qrcode/@simplewebauthn/server。
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 仅运行时依赖（--omit=dev），显著缩小镜像
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 版本号读自 package.json（供 /api/update/check），已随上面 COPY 带入。
# schema.sql：空库首启时 db-sqlite 会执行（与本地 Node 行为一致，避免缺文件告警；
# 真正建表由启动迁移负责，此步幂等）。
COPY --from=builder /app/schema.sql ./schema.sql

# 前端静态资源与编译后的服务端代码
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

# sqlite 落盘目录（compose 挂 volume 持久化）
RUN mkdir -p /app/data

EXPOSE 3100

# 入口 = dist-server/server/index.js（tsc 以 src/ 为公共根，保留 server/ 层级）
CMD ["node", "--enable-source-maps", "dist-server/server/index.js"]
