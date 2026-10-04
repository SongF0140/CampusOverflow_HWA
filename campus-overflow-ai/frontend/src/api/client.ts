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

  return envelope.data;
}
