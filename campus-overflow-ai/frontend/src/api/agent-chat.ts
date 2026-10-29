// Agent 聊天请求统一封装：个人记忆按索引、摘要、详情逐层披露，
// 最终仅将选中的详情作为 browser_memory 只读注入；会话历史按预算截取。
// SSE 事件协议与 Agent routes/chat.ts 对齐：meta / delta / done / error。
import { prepareProgressiveMemory } from "@/features/agent-chat/progressive-memory";
import { historyForRequest, type SessionMessage } from "@/features/agent-chat/browser-sessions";
import { useSessionStore } from "@/shared/stores/session-store";

export interface AgentChatMeta {
  agentRunId: string;
  traceId: string;
  ai: boolean;
}

export interface AgentChatHandlers {
  onMeta?: (meta: AgentChatMeta) => void;
  /** 流式增量文本（每 delta 一次） */
  onDelta?: (text: string) => void;
}

export interface AgentChatOptions {
  signal?: AbortSignal;
  sessionId?: string;
  history?: SessionMessage[];
  learningContext?: { course_id?: number; trusted_tag_ids?: number[]; learning_event_id?: string };
}

export class AgentChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentChatError";
  }
}

/** 解析单个 SSE 事件块（event: x / data: y 行） */
const parseSseBlock = (block: string): { event: string; data: string } | null => {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) data += line.slice("data:".length).trim();
  }
  return data !== "" ? { event, data } : null;
};

/**
 * 发送一条聊天消息并消费 SSE 流，直到 done。
 * 记忆注入：当前账号 localStorage 中有相关记忆时携带 browser_memory（≤3 条）；
 * 未登录或无记忆时省略该字段（Agent 侧提示词不含记忆段）。
 * 返回 done 事件的 finishReason；error 事件或传输中断抛 AgentChatError（中文文案）。
 */
export async function sendAgentChat(
  message: string,
  handlers: AgentChatHandlers = {},
  options: AgentChatOptions = {},
): Promise<{ finishReason: string }> {
  const userId = useSessionStore.getState().me?.id;
  const assertCurrent = () => {
    if (options.signal?.aborted || useSessionStore.getState().me?.id !== userId) {
      throw new DOMException("会话已切换或请求已取消", "AbortError");
    }
  };
  assertCurrent();
  const memory = userId !== undefined ? await prepareProgressiveMemory(
    userId, options.sessionId ?? crypto.randomUUID(), message, options.signal, assertCurrent,
  ) : [];
  assertCurrent();
  const response = await fetch("/api/agent/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      ...(memory.length > 0 ? { browser_memory: memory } : {}),
      ...(options.sessionId ? { session_id: options.sessionId } : {}),
      ...(options.history?.length ? { history: historyForRequest(options.history) } : {}),
      ...(options.learningContext ?? {}),
    }),
    cache: "no-store",
    signal: options.signal,
  });
  assertCurrent();

  if (!response.ok || !response.body || !(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    // 非 SSE 信封（如 BFF 503 降级）：透传后端中文 message
    const envelope = await response.json().catch(() => null) as { message?: string } | null;
    throw new AgentChatError(envelope?.message ?? "AI 助手暂不可用，请稍后重试");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finishReason = "";
  let sawDone = false;

  const consumeBlock = (block: string): void => {
    assertCurrent();
    const parsed = parseSseBlock(block);
    if (!parsed) return;
    if (parsed.event === "meta") {
      handlers.onMeta?.(JSON.parse(parsed.data) as AgentChatMeta);
    } else if (parsed.event === "delta") {
      handlers.onDelta?.((JSON.parse(parsed.data) as { text: string }).text);
    } else if (parsed.event === "done") {
      finishReason = (JSON.parse(parsed.data) as { finishReason?: string }).finishReason ?? "stop";
      sawDone = true;
    } else if (parsed.event === "error") {
      throw new AgentChatError((JSON.parse(parsed.data) as { message?: string }).message ?? "AI 助手处理失败，请稍后重试");
    }
  };

  const cancelReader = () => { void reader.cancel().catch(() => undefined); };
  options.signal?.addEventListener("abort", cancelReader, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      assertCurrent();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      if (buffer.length > 100_000) throw new AgentChatError("回复内容过长，请缩小问题范围");
      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        consumeBlock(buffer.slice(0, separator));
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim() !== "") consumeBlock(buffer);
  } finally {
    options.signal?.removeEventListener("abort", cancelReader);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!sawDone) {
    // 流意外结束（连接中断）：已显示的内容视为未完成片段
    throw new AgentChatError("回复中断，请重试");
  }
  return { finishReason };
}
