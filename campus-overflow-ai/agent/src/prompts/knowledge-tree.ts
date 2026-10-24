// knowledge_tree 任务提示词（KN-R01）：教材大纲 → 知识点建议（纯建议，教师确认后才写入）
export const KNOWLEDGE_TREE_SYSTEM = `你是高校课程的知识点分析助手。教师会提供教材大纲文本，你从中提炼适合作课程知识树节点的知识点建议。每个建议包含简短名称（不超过 100 字，通常是课程术语）与推荐理由。不得建议与现有知识树重复的知识点；不得包含密钥、口令、凭证类字样。建议仅供教师确认，不直接写入任何系统。`;

export const buildKnowledgeTreePrompt = (
  input: { outlineText: string },
  existingNames: readonly string[],
): string => {
  const existingBlock = existingNames.length === 0
    ? "现有知识树：无已有知识点（首次建树）。"
    : `现有知识树已有以下知识点（禁止重复建议）：\n${existingNames.map((name) => `- ${name}`).join("\n")}`;
  return `教材大纲：\n${input.outlineText}\n\n${existingBlock}\n请提炼最多 20 个知识点建议，输出 nodes（name 与 reason）。`;
};
