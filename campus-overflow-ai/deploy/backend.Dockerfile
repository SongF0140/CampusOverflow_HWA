# CampusOverflow AI 业务后端镜像（一期：backend + MySQL 即可运行）
# 基础镜像 python:3.11-slim 已通过国内加速源预拉并打标；依赖安装走清华 PyPI 镜像。
FROM python:3.11-slim

WORKDIR /app

# 拷贝清单与源码后一次性安装运行时依赖（仅主依赖组，不含 dev/redis/otel）
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple .

# 迁移脚本与应用入口
COPY alembic.ini ./
COPY alembic ./alembic

EXPOSE 8000

# 启动前先执行迁移（Alembic 保证表结构最新），再启动 API 服务
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
