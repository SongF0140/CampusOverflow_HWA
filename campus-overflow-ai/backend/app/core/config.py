# 应用配置：环境变量优先，默认值仅用于本地开发
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CampusOverflow AI Backend"
    debug: bool = True

    # MySQL 连接（同步 SQLAlchemy + PyMySQL）
    database_url: str = "mysql+pymysql://root:root@localhost:3306/campus_overflow?charset=utf8mb4"

    # 服务间调用凭证（Agent 调用 /internal/agent/* 时校验，T-12 启用）
    agent_service_token: str = "dev-agent-token"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="BACKEND_", extra="ignore")


settings = Settings()
