# 测试沙箱

仅用于并发、迁移和失败注入验证；容器端口只映射到本机，数据卷不包含真实业务数据。

## 启动

```bash
cd campus-overflow-ai/deploy/test-sandbox
cp .env.example .env
docker compose up -d
docker compose ps
```

默认端口：MySQL `3307`，Postgres `5433`。数据库名均为 `campus_overflow_test`。

## 真实 MySQL 并发用例

```bash
cd campus-overflow-ai/backend
$env:TEST_MYSQL_URL="mysql+pymysql://root:sandbox_root@127.0.0.1:3307/campus_overflow_test?charset=utf8mb4"
uv run pytest tests/test_patrol_scan_concurrency_mysql.py -q
```

未设置 `TEST_MYSQL_URL` 时该用例自动跳过，普通单元测试不依赖 Docker。

## 停止与清理

```bash
docker compose down
docker compose down -v   # 连测试数据卷一起删除
```

## 边界

- 不注入生产数据库地址或业务凭证；
- 不把本目录的默认口令复制到生产部署；
- Postgres 仅用于 Workflow/运行状态相关验证，不替代业务 MySQL。
