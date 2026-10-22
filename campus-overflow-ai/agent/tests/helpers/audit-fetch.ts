import { asTraceId } from "../../src/types";
import { auditStub } from "./audit-stub";

export function auditFetch(userId: number) {
  const audit = auditStub(userId);
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response | undefined> => {
    const path = new URL(String(input)).pathname;
    const trace = asTraceId(new Headers(init?.headers).get("x-trace-id") ?? "");
    const envelope = (data: unknown) => Response.json({ code: 200, data, message: "ok" });
    if (!path.startsWith("/internal/agent/user/runs")) return undefined;
    const body = JSON.parse(String(init?.body));
    if (path === "/internal/agent/user/runs") return envelope(await audit.createRun(body, trace));
    const id = decodeURIComponent(path.split("/")[5]);
    if (path.endsWith("/events")) return envelope(await audit.recordEvent(id, body, trace));
    return envelope(await audit.finishRun(id, body, trace));
  };
}
