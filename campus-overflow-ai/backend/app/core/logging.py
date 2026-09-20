# 关键行为日志：封禁、采纳、治理等关键动作留痕（宪法 C-08 前置形态）
import logging

action_logger = logging.getLogger("app.action")
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
if not action_logger.handlers:
    action_logger.addHandler(handler)
    action_logger.setLevel(logging.INFO)
