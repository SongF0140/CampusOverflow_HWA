import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { WORKFLOW_SERIALIZE, WORKFLOW_DESERIALIZE } from "@workflow/serde";
import { createLanguageModel } from "../config.js";

/** 只持久化空描述符；真实provider、密钥及baseURL在WorkflowAgent的模型step内解析。 */
export class GovernanceWorkflowModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "campus.governance";
  readonly modelId = "server-configured";
  readonly supportedUrls = {};
  static [WORKFLOW_SERIALIZE]() { return {}; }
  static [WORKFLOW_DESERIALIZE]() { return new GovernanceWorkflowModel(); }
  private resolve() {
    const model = createLanguageModel();
    if (typeof model === "string" || model.specificationVersion !== "v4") throw new Error("workflow_model_version");
    return model;
  }
  doGenerate(options: LanguageModelV4CallOptions) {
    return this.resolve().doGenerate({ ...options, abortSignal: options.abortSignal
      ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
  }
  doStream(options: LanguageModelV4CallOptions) {
    return this.resolve().doStream({ ...options, abortSignal: options.abortSignal
      ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
  }
}
