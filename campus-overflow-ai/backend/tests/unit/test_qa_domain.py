# qa 领域规则纯单测：免 DB，毫秒级（分层基线 D-1：domain 零框架依赖可直接单测）
from app.modules.qa import domain


def test_sanitize_strips_script_tags() -> None:
    """X-03：脚本标签被剥离（内部文本降级为纯文本，不构成可执行标记）。"""
    body = "正常内容<script>alert(1)</script>后续"
    cleaned = domain.sanitize_and_truncate_body(body)
    assert "<script>" not in cleaned
    assert "正常内容" in cleaned
    assert "后续" in cleaned


def test_sanitize_strips_event_handlers() -> None:
    """X-03：事件属性随标签一并剥离。"""
    cleaned = domain.sanitize_and_truncate_body('<img src=x onerror=alert(1)>文字')
    assert "onerror" not in cleaned
    assert "文字" in cleaned


def test_sanitize_keeps_markdown_symbols() -> None:
    """清洗只剥 HTML，Markdown 标记原样保留（渲染归前端）。"""
    body = "# 标题\n**加粗** `code`"
    cleaned = domain.sanitize_and_truncate_body(body)
    assert "**加粗**" in cleaned
    assert "`code`" in cleaned


def test_truncate_body_at_limit() -> None:
    """E-02：超长正文截断至上限。"""
    cleaned = domain.sanitize_and_truncate_body("字" * (domain.BODY_MAX_LEN + 100))
    assert len(cleaned) == domain.BODY_MAX_LEN


def test_truncate_title_at_limit() -> None:
    """E-02：超长标题截断至上限。"""
    assert len(domain.truncate_title("题" * (domain.TITLE_MAX_LEN + 10))) == domain.TITLE_MAX_LEN


def test_ensure_not_empty_rejects_blank() -> None:
    """E-01：空白标题 / 空白正文不能提交。"""
    for title, body in [("", "正文"), ("标题", "   "), ("  ", "正文")]:
        try:
            domain.ensure_not_empty(title, body)
            raise AssertionError(f"应当拒绝: title={title!r} body={body!r}")
        except domain.EmptyContentError:
            pass
    domain.ensure_not_empty("标题", "正文")  # 合法情形不抛


def test_is_visible() -> None:
    """E-10：软删除后不可见。"""
    assert domain.is_visible(None) is True
    assert domain.is_visible(object()) is False


def test_sanitize_runs_before_truncate() -> None:
    """清洗先于截断：截断点落在标签中间会留下残缺标记（M03 变异杀手）。"""
    prefix = "a" * (domain.BODY_MAX_LEN - 2)
    cleaned = domain.sanitize_and_truncate_body(prefix + "<b>继续</b>结尾")
    assert "<" not in cleaned
    assert cleaned.endswith("继续")
    assert len(cleaned) == domain.BODY_MAX_LEN


# ---------- 评论侧纯规则（T-06） ----------


def test_comment_delete_rules() -> None:
    """US-05：作者删自己、管理员删违规；其他用户拒绝。"""
    domain.ensure_comment_can_delete("student", 1, 1)  # 作者本人
    domain.ensure_comment_can_delete("admin", 1, 2)  # 管理员
    try:
        domain.ensure_comment_can_delete("student", 1, 2)
        raise AssertionError("应当拒绝非作者删除")
    except domain.CommentDeleteDeniedError:
        pass


def test_comment_sanitize_and_truncate() -> None:
    """X-03 + E-02：评论先清洗后截断至 COMMENT_MAX_LEN。"""
    cleaned = domain.sanitize_and_truncate_comment(
        "内容<script>alert(1)</script>" + "字" * (domain.COMMENT_MAX_LEN + 50)
    )
    assert "<script>" not in cleaned
    assert "内容" in cleaned
    assert len(cleaned) == domain.COMMENT_MAX_LEN


def test_comment_reply_depth_and_target_rules() -> None:
    """US-05 二级规则：父评论必须同目标且为顶级。"""
    domain.ensure_top_level_parent(None)  # 顶级评论可被回复
    try:
        domain.ensure_top_level_parent(7)
        raise AssertionError("回复的回复应当拒绝")
    except domain.CommentParentInvalidError:
        pass
    domain.ensure_parent_in_same_target(10, None, 10, None)  # 同一问题
    domain.ensure_parent_in_same_target(None, 5, None, 5)  # 同一回答
    try:
        domain.ensure_parent_in_same_target(10, None, 11, None)
        raise AssertionError("跨问题回复应当拒绝")
    except domain.CommentParentInvalidError:
        pass
