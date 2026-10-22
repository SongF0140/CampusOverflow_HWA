export class ModelCompletionError extends Error {
  constructor() {
    super("模型生成未正常完成，请重试");
    this.name = "ModelCompletionError";
  }
}

/** 当前规划与总结都不开放 SDK 工具调用，只有正常停止可视为完整输出。 */
export const assertModelCompleted = (finishReason: unknown): void => {
  if (finishReason !== "stop") throw new ModelCompletionError();
};
