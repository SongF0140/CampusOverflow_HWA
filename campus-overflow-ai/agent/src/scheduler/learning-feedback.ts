import { z } from "zod";

export const LearningFeedbackSchema = z.object({
  course_id: z.number().int().positive(),
  items: z.array(z.object({
    tag_id: z.number().int().positive(), tag_name: z.string().min(1).max(200),
    summary: z.string().min(1).max(500), count: z.number().int().positive(),
    knowledge_node_ids: z.array(z.number().int().positive()),
    question_links: z.array(z.string().regex(/^\/questions\/[1-9]\d*$/)),
  })),
});
export type LearningFeedback = z.infer<typeof LearningFeedbackSchema>;

const plain = (text: string) => text.replace(/[\r\n]/g, " ").replace(/[\\`*_{}[\]()<>#!|]/g, "\\$&");

/** 只渲染后端的确定性概括和计数，不向模型传递事件或由模型决定次数。 */
export const renderLearningFeedback = (raw: unknown, courseId: number): string => {
  const feedback = LearningFeedbackSchema.parse(raw);
  if (feedback.course_id !== courseId) throw new Error("匿名反馈课程不匹配");
  const header = "## 匿名学习反馈\n以下为学习事件次数，不代表不同学生人数；不包含私人问题原文。";
  if (!feedback.items.length) return `${header}\n本期暂无可信标签关联的匿名学习反馈。`;
  return `${header}\n${feedback.items.slice(0, 20).map(item => {
    const links = item.question_links.slice(0, 5)
      .map(link => `[公开原题](${link})`).join("、");
    return `- ${plain(item.summary)}：${item.count} 次学习事件。`
      + `建议围绕“${plain(item.tag_name)}”补充概念说明与典型例题。${links ? ` ${links}` : ""}`;
  }).join("\n")}\n最多展示前 20 个主题，每个主题最多列 5 条公开原题。`;
};
