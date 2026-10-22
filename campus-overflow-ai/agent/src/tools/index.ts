// 向指定注册表装配内置工具；HTTP 用户运行必须传入请求级实例。
import type { InternalClient } from "../internal-client.js";
import { defaultToolRegistry, type ToolRegistry } from "./registry.js";
import { createFetchModerationTargetTool } from "./fetch-moderation-target.js";
import { createFetchTagsTool } from "./fetch-tags.js";
import { createSearchCoursesTool } from "./search-courses.js";
import { createSearchQuestionsTool } from "./search-questions.js";

export const BUILTIN_TOOL_NAMES = [
  "searchCourses", "searchQuestions", "fetchTags", "fetchModerationTarget",
] as const;

export const ensureBuiltinTools = (client: InternalClient, registry: ToolRegistry = defaultToolRegistry): void => {
  const tools = [
    createSearchCoursesTool(client),
    createSearchQuestionsTool(client),
    createFetchTagsTool(client),
    createFetchModerationTargetTool(client),
  ];
  for (const tool of tools) {
    // 同一注册表重复装配保持幂等；不同用户请求不共用含凭证客户端。
    if (registry.getTool(tool.name) === undefined) {
      registry.registerTool(tool);
    }
  }
};
