// N-3 注入上下文：把 active、未过期、置信度达标的巡检笔记渲染为紧凑文本。
// 只读：不修改笔记、不接入现有 15 分钟巡检判定；默认关闭，先供管理员预览验证。
import type { InjectedPatrolNotes, PatrolNoteItem, UserInternalClient } from "../internal-client.js";
import type { TraceId } from "../types/index.js";

export const INJECTION_DEFAULT_MAX_CHARS = 2000;

const NOTE_LABELS: Record<string, string> = {
  false_positive: "误报",
  missed_case: "漏报",
  rule_degradation: "规则",
};

export interface RenderedPatrolContext {
  text: string;
  count: number;
  truncated: boolean;
}

export interface InjectionDeps {
  client: UserInternalClient;
  maxChars?: number;
  minConfidence?: number;
  limit?: number;
  traceId: TraceId;
}

const targetOf = (item: PatrolNoteItem): string => {
  if (!item.target_type) return "全局";
  return item.target_id ? `${item.target_type}#${item.target_id}` : item.target_type;
};

/** 纯函数：按字符预算逐行渲染，超出预算即停止并标记截断 */
export const renderPatrolContext = (
  items: PatrolNoteItem[],
  maxChars: number = INJECTION_DEFAULT_MAX_CHARS,
): RenderedPatrolContext => {
  const lines: string[] = [];
  let used = 0;
  for (const item of items) {
    const label = NOTE_LABELS[item.note_type] ?? item.note_type;
    const line = `- [${label}] ${targetOf(item)}（v${item.rule_version}，`
      + `置信度 ${item.confidence}）：${item.summary}`;
    if (used + line.length > maxChars) {
      return { text: lines.join("\n"), count: lines.length, truncated: true };
    }
    lines.push(line);
    used += line.length + 1;
  }
  return { text: lines.join("\n"), count: lines.length, truncated: false };
};

/** 读取注入候选并渲染；预算在两处生效：后端按笔记条数、前端按行长度 */
export const buildInjectedContext = async (
  deps: InjectionDeps,
): Promise<RenderedPatrolContext> => {
  const maxChars = deps.maxChars ?? INJECTION_DEFAULT_MAX_CHARS;
  const data: InjectedPatrolNotes = await deps.client.fetchInjectedPatrolNotes(
    { maxChars, minConfidence: deps.minConfidence, limit: deps.limit },
    deps.traceId,
  );
  const rendered = renderPatrolContext(data.items, maxChars);
  return { ...rendered, truncated: rendered.truncated || data.truncated };
};
