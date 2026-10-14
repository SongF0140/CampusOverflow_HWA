# CampusOverflow AI Agent 镜像（T-18 v4，见 specs/plan.md §9.1）
# 注意：本次 release 已在 src/app.ts 整块注释停用 /agent/chat 与 /agent/tasks/:type，
# 容器起来后仅提供 /health 与 /agent/health；不配置 OPENAI_* 也能正常运行。
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
# 构建后剔除 devDependencies（tsx / vitest / typescript 等），缩小运行时体积
RUN npm run build && npm prune --omit=dev

EXPOSE 8787
# 服务间地址与凭证由 compose 注入：BACKEND_BASE_URL、AGENT_SERVICE_TOKEN
CMD ["node", "dist/server.js"]
