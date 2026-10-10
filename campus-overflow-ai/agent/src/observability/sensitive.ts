// 敏感信息过滤：摘要写入观测记录前统一过此层（宪法 C-07/C-08：不落密钥、密码、隐私原文）
// TODO(T-14): 记忆业务落地时复用并扩展此处过滤策略（隐私原文识别、脱敏字典可配置化）
const KEY_VALUE_PATTERN =
  /(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|authorization|cookie|session[_-]?id)\s*[=:：]\s*[^\s,;&"']+/gi;

const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

/** 命中敏感模式的片段替换为掩码，其余原样保留 */
export const redactSensitive = (text: string): string =>
  text.replace(PRIVATE_KEY_BLOCK_PATTERN, "[REDACTED_PRIVATE_KEY]").replace(KEY_VALUE_PATTERN, "$1=[REDACTED]");

/** 生成写入安全的摘要：截断 + 脱敏 */
export const buildSummary = (text: string, maxLength = 200): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  const truncated = flat.length > maxLength ? `${flat.slice(0, maxLength)}…` : flat;
  return redactSensitive(truncated);
};
