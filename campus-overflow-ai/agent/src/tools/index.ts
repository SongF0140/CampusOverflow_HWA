// 内置工具装配：模块级注册表只登记一次，幂等可重复调用
import type { InternalClient } from "../internal-client.js";
import { getTool, registerTool } from "./registry.js";
import { createSearchCoursesTool } from "./search-courses.js";
import { createSearchQuestionsTool } from "./search-questions.js";

export const BUILTIN_TOOL_NAMES = ["searchCourses", "searchQuestions"] as const;

export const ensureBuiltinTools = (client: InternalClient): void => {
  const tools = [createSearchCoursesTool(client), createSearchQuestionsTool(client)];
  for (const tool of tools) {
    // 注册表无注销语义（C-06：白名单只增不减），已存在则视为同一装配
    if (getTool(tool.name) === undefined) {
      registerTool(tool);
    }
  }
};
