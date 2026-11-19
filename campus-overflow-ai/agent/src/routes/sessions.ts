import type { AgentApp } from "./support.js";
import { MemoryDisclosureSchema, discloseMemory } from "../memory/disclosure.js";

export const registerSessionRoutes = (app: AgentApp): void => {
  app.post("/agent/sessions/memory/disclose", async c => {
    c.header("cache-control", "no-store");
    const parsed = MemoryDisclosureSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ code: 400, data: null, message: "记忆披露参数不合法" }, 400);
    if (parsed.data.owner_id !== c.get("principal").user_id) {
      return c.json({ code: 403, data: null, message: "不能读取其他账号的记忆" }, 403);
    }
    if (new Set(parsed.data.items.map(entry => entry.id)).size !== parsed.data.items.length) {
      return c.json({ code: 400, data: null, message: "记忆索引不能重复" }, 400);
    }
    if (c.get("principal").role === "admin") {
      const privateContexts = c.get("internalClient").privateContexts;
      if (!privateContexts) return c.json({ code: 503, data: null, message: "服务器记忆未配置" }, 503);
      const memory = await privateContexts.memory(c.get("traceId"));
      await privateContexts.session(parsed.data.session_id, c.get("traceId"));
      const length = parsed.data.stage === "index" ? 36 : parsed.data.stage === "summary" ? 100 : 500;
      if (parsed.data.items.some(item => !memory.entries.some(entry => entry.id === item.id && entry.content.slice(0, length) === item.text))) {
        return c.json({ code: 409, data: null, message: "服务器记忆已变化，请重新读取" }, 409);
      }
    }
    return c.json({ code: 200, data: discloseMemory(parsed.data, c.get("principal")), message: "已选择当前阶段记忆" });
  });
};
