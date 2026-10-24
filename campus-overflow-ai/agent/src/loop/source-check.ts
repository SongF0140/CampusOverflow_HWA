import { z } from "zod";
import type { RunTaskKind } from "../observability/run-context.js";
import type { ToolEvidence } from "../observability/run-evidence.js";
import {
  DocDraftOutputSchema,
  KnowledgeTreeOutputSchema,
  ModerationScanOutputSchema,
  SimilarQuestionsOutputSchema,
  SuggestTagsOutputSchema,
} from "../types/index.js";

export const ChatCandidateSchema = z.object({ text: z.string().min(1).max(20_000), finishReason: z.literal("stop") });
export const ReviewIssueSchema = z.enum(["invalid_structure", "unsupported_source", "off_topic", "incomplete", "unsafe_action"]);
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
export class ReviewFailure extends Error {
  constructor(readonly issues: readonly ReviewIssue[]) { super("生成结果未通过自检"); this.name = "ReviewFailure"; }
}
const fail = (): never => { throw new ReviewFailure(["unsupported_source"]); };
const rows = (evidence: ToolEvidence[], name: string) => evidence.filter((item) => item.toolName === name)
  .flatMap((item) => Array.isArray(item.result) ? item.result as unknown[] : []);
const Question = z.object({ id: z.number().int().positive(), title: z.string() });
const Tag = z.object({ id: z.number().int().positive(), name: z.string() });

const checkDestination = (url: string, questions: Set<number>): void => {
  const match = /^\/questions\/([1-9]\d*)(?:#[A-Za-z0-9_-]+)?$/.exec(url);
  if (match && questions.has(Number(match[1]))) return;
  if (/^#[^\s]+$/.test(url)) return;
  // 外部链接不被认作站内证据；包含站内路径的绝对链接仍必须拒绝。
  if (/^https?:\/\//i.test(url) && !/questions/i.test(decodeURIComponentSafe(url))) return;
  fail();
};
const decodeURIComponentSafe = (value: string): string => {
  try { return decodeURIComponent(value); } catch { return value; }
};
const checkText = (text: string, questions: Set<number>): void => {
  if (/<[a-z][^>]*\b(?:href|src)\s*=/i.test(text)) fail();
  for (const match of text.matchAll(/\]\(\s*<?([^\s)>]+)>?(?:\s+['"][^'"]*['"])?\s*\)/g)) checkDestination(match[1], questions);
  for (const match of text.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)/gm)) checkDestination(match[1], questions);
  for (const match of text.matchAll(/(?:https?:\/\/[^\s<>"')\]]*)?\/questions\/[^\s<>"')\]]+/gi)) {
    checkDestination(match[0].replace(/[。！？；，、.,;!?]+$/, ""), questions);
  }
};
const checkStrings = (value: unknown, questions: Set<number>): void => {
  if (typeof value === "string") checkText(value, questions);
  else if (Array.isArray(value)) for (const item of value) checkStrings(item, questions);
  else if (value && typeof value === "object") for (const item of Object.values(value)) checkStrings(item, questions);
};

/** 仅验证可由真实工具结果决定的来源；自然语言语义还须交无工具审查器复核。 */
export const validateOutput = (kind: RunTaskKind, output: unknown, evidence: ToolEvidence[]): unknown => {
  const schemas = { chat: ChatCandidateSchema, doc_draft: DocDraftOutputSchema, moderation_scan: ModerationScanOutputSchema,
    similar_questions: SimilarQuestionsOutputSchema, suggest_tags: SuggestTagsOutputSchema, knowledge_tree: KnowledgeTreeOutputSchema };
  const parsed = schemas[kind].safeParse(output);
  if (!parsed.success) throw new ReviewFailure(["invalid_structure"]);
  const questions = new Map(rows(evidence, "searchQuestions").flatMap((row) => {
    const item = Question.safeParse(row); return item.success ? [[item.data.id, item.data] as const] : [];
  }));
  const tags = new Map(rows(evidence, "fetchTags").flatMap((row) => {
    const item = Tag.safeParse(row); return item.success ? [[item.data.id, item.data] as const] : [];
  }));
  if (kind === "similar_questions") {
    const result = SimilarQuestionsOutputSchema.parse(parsed.data);
    for (const item of result.items) {
      if (questions.get(item.questionId)?.title !== item.title || item.url !== `/questions/${item.questionId}`) fail();
    }
    if (result.hasInSiteEvidence !== (result.items.length > 0)) fail();
  }
  if (kind === "suggest_tags") for (const tag of SuggestTagsOutputSchema.parse(parsed.data).tags) {
    if (tag.tagId !== undefined && tags.get(tag.tagId)?.name !== tag.name) fail();
  }
  checkStrings(parsed.data, new Set(questions.keys()));
  return parsed.data;
};
