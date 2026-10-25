import { z } from "zod";
import type { RecentQuestionItem } from "../internal-client.js";

export const TagFocusSchema = z.object({
  tag_id: z.number().int().positive(),
  common_confusion: z.string().min(1).max(500),
  teaching_focus: z.string().min(1).max(500),
  question_ids: z.array(z.number().int().positive()).max(200).default([]),
});
type TagFocus = z.infer<typeof TagFocusSchema>;
const MAX_TAGS = 10;

export interface RepeatedTag {
  tag_id: number; tag_name: string; question_count: number; question_ids: number[];
}

/** 真实标签和问题 ID 决定频次，不依赖模型映射或模型计数。 */
export const collectRepeatedTags = (questions: readonly RecentQuestionItem[]): RepeatedTag[] => {
  const unique = new Map(questions.map((item) => [item.id, item]));
  const tags = new Map<number, { name: string; ids: Set<number> }>();
  for (const question of [...unique.values()].sort((a, b) => a.id - b.id)) {
    for (const tag of question.tags ?? []) {
      const group = tags.get(tag.id) ?? { name: tag.name, ids: new Set<number>() };
      group.ids.add(question.id);
      tags.set(tag.id, group);
    }
  }
  return [...tags].filter(([, group]) => group.ids.size >= 2).map(([id, group]) => ({
    tag_id: id, tag_name: group.name, question_count: group.ids.size, question_ids: [...group.ids].sort((a, b) => a - b),
  })).sort((a, b) => b.question_count - a.question_count || a.tag_id - b.tag_id).slice(0, MAX_TAGS);
};

export const renderTagFocus = (questions: readonly RecentQuestionItem[], suggestions: readonly TagFocus[]): string => {
  const groups = collectRepeatedTags(questions);
  const sampleCount = new Set(questions.map((item) => item.id)).size;
  const header = `高频提问标签与教学侧重点\n本期纳入分析的 ${sampleCount} 条不同问题；同一标签至少关联 2 条不同问题，最多展示前 10 项。\n此处表示主题提问集中，不代表内容重复、学生人数或掌握率；未标记标签的问题不参与本节统计。`;
  if (!groups.length) return `${header}\n未发现至少关联 2 条不同问题的标签。`;
  const sections = groups.map((group) => {
    const ids = new Set(group.question_ids);
    const advice = suggestions.find((item) => item.tag_id === group.tag_id
      && new Set(item.question_ids).size >= 2 && item.question_ids.every((id) => ids.has(id)));
    const sources = group.question_ids.slice(0, 5).map((id) => `#${id}`).join("、");
    const remaining = group.question_count > 5 ? `（另有 ${group.question_count - 5} 条）` : "";
    return `- ${group.tag_name}：${group.question_count} 个不同问题\n`
      + `  共性疑问：${advice?.common_confusion ?? "这些问题共享该标签，尚缺少可靠的共性疑问分析。"}\n`
      + `  教学侧重点：${advice?.teaching_focus ?? "建议复看相关问题，补充概念对照与典型例题，再用随堂练习确认理解。"}\n`
      + `  关联问题 ${sources}${remaining}`;
  });
  return `${header}\n${sections.join("\n\n")}`;
};
