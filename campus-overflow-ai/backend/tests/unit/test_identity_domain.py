# identity 领域层纯单测：不起数据库、不起 FastAPI，毫秒级执行
# 分层基线 D-1：规则在 domain.py，零框架依赖，直接可测。
import pytest

from app.modules.identity import domain


class TestEnsureNotBanned:
    def test_active_账号通过(self) -> None:
        domain.ensure_not_banned(domain.STATUS_ACTIVE)

    def test_banned_账号拒绝(self) -> None:
        with pytest.raises(domain.UserBannedError) as exc_info:
            domain.ensure_not_banned(domain.STATUS_BANNED)
        assert exc_info.value.http_status == 403
        assert "封禁" in exc_info.value.message


class TestEnsureCanBan:
    @pytest.mark.parametrize("role", [domain.ROLE_STUDENT, domain.ROLE_TEACHER])
    def test_非管理员可封禁(self, role: str) -> None:
        domain.ensure_can_ban(role)

    def test_管理员不可封禁(self) -> None:
        with pytest.raises(domain.AdminBanDeniedError) as exc_info:
            domain.ensure_can_ban(domain.ROLE_ADMIN)
        assert exc_info.value.http_status == 400


class TestDomainError:
    def test_默认状态码为400(self) -> None:
        err = domain.AccountExistsError()
        assert err.http_status == 400
        assert "注册" in err.message

    def test_异常可被捕获为DomainError(self) -> None:
        with pytest.raises(domain.WrongCredentialsError):
            raise domain.WrongCredentialsError()
