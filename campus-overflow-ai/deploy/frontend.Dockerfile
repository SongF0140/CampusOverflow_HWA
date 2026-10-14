# CampusOverflow AI 前端镜像（T-18 v4：三服务容器化，见 specs/plan.md §9.1）
# 多阶段：构建阶段产出 Next standalone 自包含运行时，运行阶段不带源码与 devDependencies
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# next.config 的 output: "standalone" 是本镜像的前置条件
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# standalone 目录已含 server.js、裁剪后的 package.json 与运行依赖
COPY --from=builder /app/package.json ./
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
# 运行时读取 BACKEND_ORIGIN / AGENT_ORIGIN（BFF 与 /api/health 聚合的目标）
CMD ["node", "server.js"]
