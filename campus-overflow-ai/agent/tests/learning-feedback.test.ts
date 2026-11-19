import { describe, expect, it } from "vitest";
import { renderLearningFeedback } from "../src/scheduler/learning-feedback";

const feedback = () => ({ course_id: 1, items: [{
  tag_id: 2, tag_name: "递归", summary: "关于“递归”的学习疑问", count: 4,
  knowledge_node_ids: [8], question_links: ["/questions/11"],
}] });

describe("匿名学习反馈展示边界", () => {
  it("拒绝跨课程反馈或外部伪造链接", () => {
    expect(() => renderLearningFeedback(feedback(), 2)).toThrow();
    const foreign = feedback();
    foreign.items[0].question_links = ["https://malicious.example/questions/11"];
    expect(() => renderLearningFeedback(foreign, 1)).toThrow();
  });

  it("只展示确定性概括、事件数与受控链接，忽略额外私密字段", () => {
    const text = renderLearningFeedback({ ...feedback(), private_message: "私人原文不应该出现" }, 1);
    expect(text).toContain("4 次学习事件");
    expect(text).toContain("不代表不同学生人数");
    expect(text).toContain("[公开原题](/questions/11)");
    expect(text).not.toContain("私人原文不应该出现");
  });
});
