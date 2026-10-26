// Agent 聊天请求的唯一前端封装（T-14 端到端接线点，US-17/AG-R04）：
// 发送前从当前登录账号的浏览器记忆取上下文（buildMemoryContext，最新 20 条），
// 随请求作为 browser_memory 只读注入；清空后为空不再携带。
// SSE 事件协议与 Agent routes/chat.ts 对齐：meta / delta / done / error。
import { buildMemoryContext } from "@/shared/lib/browser-memory";
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
 * 记忆注入：当前账号 localStorage 中有记忆时携带 browser_memory（≤20 条）；
 * 未登录或无记忆时省略该字段（Agent 侧提示词不含记忆段）。
 * 返回 done 事件的 finishReason；error 事件或传输中断抛 AgentChatError（中文文案）。
 */
export async function sendAgentChat(
  message: string,
  handlers: AgentChatHandlers = {},
): Promise<{ finishReason: string }> {
  const userId = useSessionStore.getState().me?.id;
  const memory = userId !== undefined ? buildMemoryContext(userId) : [];
  const response = await fetch("/api/agent/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      ...(memory.length > 0 ? { browser_memory: memory } : {}),
    }),
    cache: "no-store",
  });

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

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      consumeBlock(buffer.slice(0, separator));
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim() !== "") consumeBlock(buffer);
  if (!sawDone) {
    // 流意外结束（连接中断）：已显示的内容视为未完成片段
    throw new AgentChatError("回复中断，请重试");
  }
  return { finishReason };
}
