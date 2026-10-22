export type RunStopKind = "cancelled" | "timeout" | "upstream_timeout";

export class RunStoppedError extends Error {
  readonly status: 408 | 504;
  readonly summary: string;
  constructor(readonly kind: RunStopKind) {
    const summary = kind === "cancelled" ? "任务已取消" : kind === "timeout" ? "任务运行超时" : "上游请求超时";
    super(kind === "cancelled" ? summary : `${summary}，请重试`);
    this.name = "RunStoppedError";
    this.summary = summary;
    this.status = kind === "cancelled" ? 408 : 504;
  }
}

export const checkSignal = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof RunStoppedError ? signal.reason : new RunStoppedError("cancelled");
  }
};

/** 上游可能忽略 abort；停止等待并消费迟到异常，但不再消费迟到结果。 */
export const waitForSignal = <T>(signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> => {
  if (!signal) return action();
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      try { checkSignal(signal); } catch (error) { reject(error); }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => { checkSignal(signal); return action(); }).then((value) => {
      cleanup();
      try { checkSignal(signal); resolve(value); } catch (error) { reject(error); }
    }, (error: unknown) => {
      cleanup();
      try { checkSignal(signal); reject(error); } catch (stopped) { reject(stopped); }
    });
  });
};

export const withUpstreamDeadline = async <T>(
  parent: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>, timeoutMs = 60_000,
): Promise<T> => {
  const timeout = new AbortController();
  const signal = parent ? AbortSignal.any([parent, timeout.signal]) : timeout.signal;
  const timer = setTimeout(() => timeout.abort(new RunStoppedError("upstream_timeout")), timeoutMs);
  try { return await waitForSignal(signal, () => action(signal)); }
  catch (error) { timeout.abort(new RunStoppedError("cancelled")); throw error; }
  finally { clearTimeout(timer); }
};
