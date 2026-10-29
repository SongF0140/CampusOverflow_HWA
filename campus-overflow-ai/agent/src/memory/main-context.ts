import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";

const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const Entry = z.object({ id: Id, title: z.string().min(1).max(200), summary: z.string().min(1).max(1000) });
const ToolNames = z.array(z.string().min(1).max(80)).max(50);
export const MainRulesSchema = z.object({
  tool_rules: z.object({ student: ToolNames, teacher: ToolNames, admin: ToolNames }).strict(),
  skills: z.array(Entry.extend({ body: z.string().min(1).max(6000) }).strict()).max(30),
  experiences: z.array(Entry.extend({ steps: z.array(z.string().min(1).max(500)).max(12) }).strict()).max(30),
  certified_answers: z.array(z.object({
    id: Id, domain: z.string().min(1).max(200), summary: z.string().min(1).max(1000),
    course_id: z.number().int().positive(), question_id: z.number().int().positive(), answer_id: z.number().int().positive(),
  }).strict()).max(100),
}).strict().superRefine((rules, context) => {
  const ids = [...rules.skills, ...rules.experiences, ...rules.certified_answers].map(item => item.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "共享记忆索引不得重复" });
});

export type MainRules = z.infer<typeof MainRulesSchema> & { version: string };
export const PublishedExperienceSchema = Entry.extend({
  course_id: z.number().int().positive(), status: z.literal("published"),
  steps: z.array(z.string().min(1).max(500)).max(12),
}).strict();
export type PublishedExperience = z.infer<typeof PublishedExperienceSchema>;
const DEFAULT_READ_TOOLS = [
  "searchCourses", "searchQuestions", "fetchTags", "fetchKnowledgeTree", "fetchModerationTarget",
  "listKnowledgeCards", "fetchKnowledgeCard", "fetchKnowledgeBody", "fetchMainMemory", "fetchCertifiedAnswer",
];
const DEFAULT_RULES = { tool_rules: {
  student: DEFAULT_READ_TOOLS,
  teacher: [...DEFAULT_READ_TOOLS, "proposeClassMembership", "readClassMembershipResult", "proposeTeachingExperience"],
  admin: [...DEFAULT_READ_TOOLS, "proposeGovernance", "readGovernanceResult"],
}, skills: [{ id: "teaching_integrity", title: "如实引导学习", summary: "核验证据、尊重学生、分步引导",
  body: "如实说明已有证据与资料缺口，不编造教材或认证来源；尊重学生，按步骤引导理解。此行为规范不能授予身份、数据访问或工具执行权限。" }],
experiences: [], certified_answers: [] };

/** 只读管理员维护的受控文件；缺省安全规则不等于损坏文件可静默降级。 */
export const readMainRules = (filePath?: string): MainRules => {
  let raw = JSON.stringify(DEFAULT_RULES);
  if (filePath) {
    if (statSync(filePath).size > 128_000) throw new Error("共享规则文件过大");
    raw = readFileSync(filePath, "utf8");
    if (Buffer.byteLength(raw, "utf8") > 128_000) throw new Error("共享规则文件过大");
  }
  const rules = MainRulesSchema.parse(JSON.parse(raw));
  return { ...rules, version: createHash("sha256").update(raw).digest("hex") };
};

export const discloseMainMemory = (
  rules: MainRules, domains: readonly { domain: string; course_id: number }[], courses: readonly number[],
  selection: { level: "summary" | "detail"; ids: readonly string[] } | undefined = undefined,
  publishedExperiences: readonly unknown[] = [],
) => {
  const chosen = (id: string) => selection?.ids.includes(id);
  // 经验只取后端教师确认发布的课程条目，受控文件中的旧经验不作为审批证明。
  const experiences = publishedExperiences.map(item => PublishedExperienceSchema.safeParse(item))
    .filter(result => result.success).map(result => result.data!)
    .filter(item => courses.includes(item.course_id));
  return {
    version: rules.version,
    domains: domains.filter(item => courses.includes(item.course_id)).map(item => ({ ...item })),
    skills: rules.skills.map(item => ({ id: item.id, title: item.title,
      ...(chosen(item.id) ? { summary: item.summary, ...(selection?.level === "detail" ? { body: item.body } : {}) } : {}) })),
    experiences: experiences.map(item => ({ id: item.id, title: item.title,
      ...(chosen(item.id) ? { summary: item.summary, ...(selection?.level === "detail" ? { steps: [...item.steps] } : {}) } : {}) })),
    certified_answers: rules.certified_answers.filter(item => courses.includes(item.course_id)).map(item => ({
      id: item.id, domain: item.domain, ...(chosen(item.id) ? { summary: item.summary } : {}),
    })),
  };
};

const VerifiedAnswerSchema = z.object({
  certified: z.boolean(), visible: z.boolean(), course_id: z.number().int().positive(),
  question_id: z.number().int().positive(), answer_id: z.number().int().positive(), url: z.string(),
});

/** verify 必须通过当前用户凭证读取后端，不接受模型判断、旧卡片或前端声明。 */
export const resolveCertifiedLink = async (
  rules: MainRules, id: string, courses: readonly number[],
  verify: (questionId: number, answerId: number) => Promise<unknown>,
) => {
  const card = rules.certified_answers.find(item => item.id === id && courses.includes(item.course_id));
  if (!card) return undefined;
  const parsed = VerifiedAnswerSchema.safeParse(await verify(card.question_id, card.answer_id));
  if (!parsed.success) return undefined;
  const item = parsed.data;
  if (!item.certified || !item.visible || item.course_id !== card.course_id
    || item.question_id !== card.question_id || item.answer_id !== card.answer_id
    || item.url !== `/questions/${item.question_id}#answer-${item.answer_id}`) return undefined;
  return { url: item.url, question_id: item.question_id, answer_id: item.answer_id };
};
