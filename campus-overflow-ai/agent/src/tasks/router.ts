// task router：按 TaskType 分发到对应 handler；第一阶段单 Agent Loop，无多 Agent 协作
import type { z } from "zod";

import type { LanguageModel } from "ai";

import type { RunContext } from "../observability/run-context.js";
import type { InternalClient } from "../internal-client.js";
import type { TaskType } from "../types/index.js";

export class TaskRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskRouterError";
  }
}

export interface TaskContext {
  runContext: RunContext;
  model: LanguageModel;
  /** 内部白名单接口客户端：handler 检索站内候选用；缺省时 handler 以无依据模式运行 */
  internalClient?: InternalClient;
}

export interface TaskHandler<I = unknown> {
  taskType: TaskType;
  /** 入参 Zod schema：分发前统一校验，失败即 400 */
  inputSchema: z.ZodType<I>;
  /** 返回值必须是已通过自检的结构化输出 */
  run: (input: I, context: TaskContext) => Promise<unknown>;
}

const handlers = new Map<TaskType, TaskHandler<never>>();

/** 注册 handler：泛型在注册边界收敛一次，注册表内部以 never 存储避免 any */
export const registerTaskHandler = <I>(handler: TaskHandler<I>): void => {
  if (handlers.has(handler.taskType)) {
    throw new Error(`task handler already registered: ${handler.taskType}`);
  }
  handlers.set(handler.taskType, handler as unknown as TaskHandler<never>);
};

export const getTaskHandler = (taskType: TaskType): TaskHandler<never> | undefined => handlers.get(taskType);

export const dispatchTask = async (taskType: TaskType, rawInput: unknown, context: TaskContext): Promise<unknown> => {
  const handler = handlers.get(taskType);
  if (!handler) {
    throw new TaskRouterError(`未注册的任务类型: ${taskType}`);
  }
  // parse 后按 handler 声明的入参类型进入 run（校验即收敛类型）
  const input = handler.inputSchema.parse(rawInput) as never;
  return handler.run(input, context);
};
