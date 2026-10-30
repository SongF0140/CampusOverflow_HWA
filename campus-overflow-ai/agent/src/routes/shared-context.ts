import { z } from "zod";
import { getKnowledgeCatalog } from "../knowledge/runtime.js";
import { loadSharedContext, readCertifiedLink } from "../memory/shared-context.js";
import { toErrorResponse, type AgentApp } from "./support.js";

const CourseId = z.coerce.number().int().positive();
const Proposal = z.object({ proposal_id: z.uuid(), course_id: z.number().int().positive(),
  title: z.string().trim().min(1).max(200), summary: z.string().trim().min(1).max(1000),
  steps: z.array(z.string().trim().min(1).max(500)).min(1).max(12) }).strict();

export const registerSharedContextRoutes = (app: AgentApp) => {
  const wrap = (handler: (c: import("hono").Context<import("../auth/request-context.js").AgentEnvironment>) => Promise<unknown>) =>
    async (c: import("hono").Context<import("../auth/request-context.js").AgentEnvironment>) => {
      c.header("cache-control", "no-store");
      try { return c.json({ code: 200, data: await handler(c), message: "已读取当前授权资料" }); }
      catch (error) { const result = toErrorResponse(error); return c.json({ code: result.status, data: null, message: result.message }, result.status); }
    };
  app.get("/agent/courses/:courseId/trusted-tags", wrap(c =>
    c.get("internalClient").fetchTrustedTags(CourseId.parse(c.req.param("courseId")), c.get("traceId"))));
  app.get("/agent/main-memory", wrap(c => {
    const query = z.object({ course_id: CourseId.optional(), level: z.enum(["summary", "detail"]).optional(),
      ids: z.string().max(2000).optional() }).parse(c.req.query());
    return loadSharedContext(c.get("internalClient"), query.course_id, c.get("traceId"),
      query.level ? { level: query.level, ids: query.ids?.split(",").slice(0, 10) ?? [] } : undefined);
  }));
  app.get("/agent/main-memory/certified/:cardId", wrap(c => readCertifiedLink(c.get("internalClient"),
    CourseId.parse(c.req.query("course_id")), z.string().min(1).max(80).parse(c.req.param("cardId")), c.get("traceId"))));
  app.post("/agent/experiences/proposals", wrap(async c => c.get("internalClient").submitExperienceProposal(
    Proposal.parse(await c.req.json()), c.get("traceId"))));
  for (const level of ["index", "card", "body"] as const) {
    app.get(`/agent/knowledge/:courseId/${level}`, wrap(async c => {
      const courseId = CourseId.parse(c.req.param("courseId"));
      await c.get("internalClient").fetchTrustedTags(courseId, c.get("traceId"));
      const catalog = getKnowledgeCatalog();
      if (!catalog) return { configured: false, cards: [] };
      await catalog.refresh();
      if (level === "index") return catalog.list([courseId]);
      const id = z.string().min(1).max(500).parse(c.req.query("card_id"));
      return level === "card" ? catalog.getCard(id, [courseId]) ?? null
        : await catalog.getBody(id, [courseId], z.string().regex(/^[a-f0-9]{64}$/).parse(c.req.query("version"))) ?? null;
    }));
  }
};
