import { z } from "zod";

const item = (length: number) => z.object({ id: z.string().min(1).max(80), text: z.string().min(1).max(length) }).strict();
const base = {
  owner_id: z.number().int().positive(), session_id: z.uuid(), message: z.string().min(1).max(2000),
};
export const MemoryDisclosureSchema = z.discriminatedUnion("stage", [
  z.object({ ...base, stage: z.literal("index"), items: z.array(item(36)).max(50) }).strict(),
  z.object({ ...base, stage: z.literal("summary"), items: z.array(item(100)).max(5) }).strict(),
  z.object({ ...base, stage: z.literal("detail"), items: z.array(item(500)).max(3) }).strict(),
]);

/** 仅筛选调用方当前阶段已披露的条目，无服务器缓存或记忆写入。 */
export const discloseMemory = (raw: unknown, principal: { user_id: number }) => {
  const input = MemoryDisclosureSchema.parse(raw);
  if (input.owner_id !== principal.user_id) throw new Error("账号记忆不匹配");
  if (new Set(input.items.map(entry => entry.id)).size !== input.items.length) {
    throw new Error("记忆索引重复");
  }
  const question = input.message.toLocaleLowerCase();
  const terms = new Set(question.match(/[\p{Script=Han}]|[a-z0-9]+/gu) ?? []);
  const ranked = input.items.map((entry, index) => {
    const text = entry.text.toLocaleLowerCase();
    const overlap = [...terms].filter(term => text.includes(term)).length;
    const preference = /偏好|喜欢|希望|prefer/.test(text) ? 0.5 : 0;
    return { entry, index, score: overlap + preference };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = input.stage === "detail"
    ? input.items : ranked.slice(0, input.stage === "index" ? 5 : 3).map(row => row.entry);
  return {
    session_id: input.session_id, stage: input.stage, selected_ids: selected.map(entry => entry.id),
    ...(input.stage === "detail" ? { items: selected } : {}),
  };
};
