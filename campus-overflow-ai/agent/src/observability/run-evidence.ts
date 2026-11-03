export interface ToolEvidence { toolName: string; result: unknown }

/** 仅供本次候选检查，不落日志；返工重规划重新采集，预算保持累计。 */
export const createRunEvidence = () => {
  const results: ToolEvidence[] = [];
  let webRetrieval = false;
  return Object.freeze({
    markWebRetrieval: () => { webRetrieval = true; },
    record: (toolName: string, result: unknown) => { results.push({ toolName, result: structuredClone(result) }); },
    clear: () => { results.length = 0; },
    // 返工可清正文证据，但不能借清空记录绕过已尝试联网后的引用约束。
    snapshot: (): ToolEvidence[] => [...structuredClone(results), ...(webRetrieval ? [{ toolName: "webRetrievalAttempt", result: {} }] : [])],
  });
};
