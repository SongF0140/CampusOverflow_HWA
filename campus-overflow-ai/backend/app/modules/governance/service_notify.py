# 治理通知（T-15-C，US-15 治理部分 / E-11）：工单与申诉事件的通知落库。
# 复用 interaction.notify 的同事务写入（D-8：只 flush，由调用方用例提交）；
# type=moderation（前端 NotificationsView 已预留该类型的图标/标签映射）。
# 链接为前端路由锚点；文案固定短句、不含正文原文与敏感词（C-07 精神）。
from sqlalchemy.orm import Session

from app.core.logging import action_logger
from app.modules.identity import service as identity_service
from app.modules.interaction import service as interaction_service
from app.modules.qa import service as qa_service


def _content_recipient(db: Session, target_type: str, target_id: int) -> int | None:
    """内容类工单的当事人：目标作者（含已隐藏/已软删——被处置者恰需收到结果）。"""
    if target_type == "user":
        return target_id
    return qa_service.get_content_author(db, target_type, target_id)


def notify_case_created(db: Session, case_id: int, target_type: str, target_id: int) -> None:
    """工单创建 → 通知全部管理员（静默巡检与 Agent 工单的管理员感知入口）。"""
    admin_ids = identity_service.get_admin_ids(db)
    if not admin_ids:
        return
    interaction_service.notify(
        db, actor_id=0,  # 系统事件无人类操作者；notify 按 actor 排除本人，0 不会命中收件人
        recipient_ids=admin_ids,
        notification_type="moderation",
        title=f"新审核工单待处理：{target_type} #{target_id}",
        link=f"/admin/moderation/approvals?case_id={case_id}",
    )
    action_logger.info("notify_case_created case_id=%s admins=%d", case_id, len(admin_ids))


def notify_case_resolved(
    db: Session, case_id: int, target_type: str, target_id: int,
    decision: str, actor_id: int | None,
) -> None:
    """处置完成 → 通知当事人（结果与后续救济入口）。"""
    recipient = _content_recipient(db, target_type, target_id)
    if recipient is None:
        return
    decision_text = {
        "hide": "内容已被隐藏", "delete": "内容已被删除", "ban": "账号已被封禁",
        "ban_temp": "账号已被限时封禁", "warn": "你已收到正式警告",
        "skip": "经复核无需处置",
    }.get(decision, decision)
    interaction_service.notify(
        db, actor_id=actor_id or 0,
        recipient_ids=[recipient],
        notification_type="moderation",
        title=f"审核处置结果：{decision_text}",
        link=f"/appeals/new?case_id={case_id}",
    )


def notify_appeal_submitted(
    db: Session, appeal_id: int, case_id: int, appellant_id: int,
) -> None:
    """申诉提交 → 通知全部管理员（与工单创建同一感知通道）。"""
    admin_ids = identity_service.get_admin_ids(db)
    if not admin_ids:
        return
    interaction_service.notify(
        db, actor_id=appellant_id,
        recipient_ids=admin_ids,
        notification_type="moderation",
        title="收到新的申诉待复核",
        link=f"/admin/moderation/appeals?appeal_id={appeal_id}",
    )


def notify_appeal_resolved(
    db: Session, appeal_id: int, appellant_id: int, accepted: bool, actor_id: int,
) -> None:
    """申诉复核结果 → 通知申诉人。"""
    interaction_service.notify(
        db, actor_id=actor_id,
        recipient_ids=[appellant_id],
        notification_type="moderation",
        title="申诉复核完成：处置已撤销" if accepted else "申诉复核完成：维持原处置",
        link="/notifications",
    )
