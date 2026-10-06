// doc_draft handler：起草讲解文档草稿；草稿仅返回给请求方，不进入任何发布通道
import { generateStructured } from "../loop/self-check.js";
import { DocDraftInputSchema, DocDraftOutputSchema, type DocDraftInput } from "../types/index.js";
import type { TaskHandler } from "./router.js";

const DOC_DRAFT_SYSTEM = `你是高校课程问答平台的讲解文档起草助手，产出 Markdown 格式的讲解草稿；仅作为草稿供人工编辑，不自动发布。`;

export const docDraftHandler: TaskHandler<DocDraftInput> = {
  taskType: "doc_draft",
  inputSchema: DocDraftInputSchema,
  run: async (input, context) =>
    generateStructured({
      model: context.model,
      schema: DocDraftOutputSchema,
      system: DOC_DRAFT_SYSTEM,
      prompt: `主题：${input.topic}\n请起草一份面向本科生的讲解文档草稿，输出 title 与 bodyMarkdown。`,
    }),
};
