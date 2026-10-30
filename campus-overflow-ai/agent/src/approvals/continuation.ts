export const RESULT_CHECK_DELAYS = [2_000, 5_000, 10_000] as const;
export type ContinuationOutcome = "completed" | "result_unknown" | "failed";
export const waitForCheck = (milliseconds: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new Error("cancelled")); return; }
  const abort = () => { clearTimeout(timer); reject(new Error("cancelled")); };
  const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
  signal?.addEventListener("abort", abort, { once: true });
});
