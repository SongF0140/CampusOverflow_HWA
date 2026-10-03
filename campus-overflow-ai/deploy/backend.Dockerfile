# CampusOverflow AI 业务后端镜像（一期：backend + MySQL 即可运行）
# 使用官方 uv 镜像加速依赖安装；运行时仅装主依赖，不含 dev/redis/otel 可选组。
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

WORKDIR /app

# 先只拷贝依赖清单利用层缓存，再安装运行时依赖
COPY pyproject.toml ./
RUN uv pip install --system --no-cache .

# 再拷贝应用代码与迁移
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

EXPOSE 8000

# 启动前先执行迁移（ Alembic 保证表结构最新），再启动 API 服务
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
