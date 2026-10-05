// 统一 HTTP 客户端：浏览器只调同源 BFF（/api/backend/api/**），不直连 8000
// 详见 docs/前端架构/前端服务需求文档.md §3.3
export interface ApiEnvelope<T> {
  code: number;
  data: T;
  message: string;
}

const BASE = "/api/backend/api";

export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isUnauthorized(): boolean {
    return this.code === 401;
  }

  get isForbidden(): boolean {
    return this.code === 403;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await apiFetchWithMessage<T>(path, init);
  return data;
}

/**
 * 与 apiFetch 相同，但同时返回后端 message。
 * 用于需要展示后端提示文案的场景（如 E-02「内容超长已截断」提示放在 message 里）。
 */
export async function apiFetchWithMessage<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; message: string }> {
  const headers = new Headers(init?.headers);
  // 只有带请求体时才声明 JSON，避免 GET 也携带无意义的 content-type
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok || envelope === null) {
    throw new ApiError(
      envelope?.code ?? response.status,
      envelope?.message ?? "服务暂时不可用，请稍后重试",
    );
  }

  return { data: envelope.data, message: envelope.message };
}

// 查询参数序列化：蛇形键直传，跳过 undefined/null（可选参数不出现）、空串
export type QueryParams = Record<
  string,
  string | number | boolean | undefined | null
>;

export function buildQuery(params: QueryParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}
