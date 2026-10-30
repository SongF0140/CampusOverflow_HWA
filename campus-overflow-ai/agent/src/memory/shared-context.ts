import { createHash } from "node:crypto";
import type { UserInternalClient } from "../internal-client.js";
import { getKnowledgeCatalog } from "../knowledge/runtime.js";
import type { TraceId } from "../types/index.js";
import { discloseMainMemory, readMainRules, resolveCertifiedLink } from "./main-context.js";

export const loadSharedContext = async (
  client: UserInternalClient, courseId: number | undefined, trace: TraceId,
  selection?: { level: "summary" | "detail"; ids: string[] },
) => {
  const rules = readMainRules(process.env.MAIN_AGENT_RULES_PATH);
  if (courseId === undefined) return discloseMainMemory(rules, [], [], selection, []);
  await client.fetchTrustedTags(courseId, trace);
  const experiences = await client.fetchPublishedExperiences(courseId, trace);
  const catalog = getKnowledgeCatalog();
  await catalog?.refresh();
  const index = catalog?.list([courseId]);
  const domains = index?.cards.map(card => ({ domain: card.domain, course_id: card.course_id })) ?? [];
  const result = discloseMainMemory(rules, domains, [courseId], selection, experiences);
  return { ...result, version: createHash("sha256")
    .update(JSON.stringify([rules.version, index?.version ?? "", experiences])).digest("hex") };
};

export const readCertifiedLink = async (client: UserInternalClient, courseId: number, id: string, trace: TraceId) => {
  await client.fetchTrustedTags(courseId, trace);
  return resolveCertifiedLink(readMainRules(process.env.MAIN_AGENT_RULES_PATH), id, [courseId],
    async (_questionId, answerId) => client.verifyCertifiedAnswer(answerId, trace));
};
