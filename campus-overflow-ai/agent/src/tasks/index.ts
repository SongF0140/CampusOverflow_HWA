// 四类任务 handler 装配：模块级注册一次，幂等可重复导入
import { docDraftHandler } from "./doc-draft.js";
import { moderationScanHandler } from "./moderation-scan.js";
import { getTaskHandler, registerTaskHandler, type TaskHandler } from "./router.js";
import { similarQuestionsHandler } from "./similar-questions.js";
import { suggestTagsHandler } from "./suggest-tags.js";

const BUILTIN_HANDLERS = [
  similarQuestionsHandler,
  suggestTagsHandler,
  moderationScanHandler,
  docDraftHandler,
];

// 注册边界收敛一次：四个具体 handler 的联合在此 cast 为注册表的 never 存储形态（非 any）
const registerIfAbsent = (handler: TaskHandler<never>): void => {
  if (getTaskHandler(handler.taskType) === undefined) {
    registerTaskHandler(handler);
  }
};

export const ensureBuiltinTaskHandlers = (): void => {
  for (const handler of BUILTIN_HANDLERS) {
    registerIfAbsent(handler as unknown as TaskHandler<never>);
  }
};

ensureBuiltinTaskHandlers();

export { dispatchTask, getTaskHandler, TaskRouterError } from "./router.js";
export type { TaskContext, TaskHandler } from "./router.js";
