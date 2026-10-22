export interface ToolEvidence { toolName: string; result: unknown }

/** 仅供本次候选检查，不落日志；返工重规划重新采集，预算保持累计。 */
export const createRunEvidence = () => {
  const results: ToolEvidence[] = [];
  return Object.freeze({
    record: (toolName: string, result: unknown) => { results.push({ toolName, result: structuredClone(result) }); },
    clear: () => { results.length = 0; },
    snapshot: (): ToolEvidence[] => structuredClone(results),
  });
};
