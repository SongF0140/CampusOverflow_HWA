type StopService = () => void | Promise<void>;
type StartService = () => StopService | Promise<StopService>;

/** 生命周期归属服务器实例，不归属HTTP请求；close会等待迟到的异步句柄。 */
export const createBackgroundServices = (starters: readonly StartService[]) => {
  const stops: StopService[] = [];
  let starting: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let isClosed = false;
  const drain = async (): Promise<unknown[]> => {
    const failures: unknown[] = [];
    for (const stop of stops.splice(0).reverse()) {
      try { await stop(); } catch (error) { failures.push(error); }
    }
    return failures;
  };
  const start = (): Promise<void> => {
    if (isClosed) return Promise.reject(new Error("后台服务已关闭"));
    starting ??= (async () => {
      try {
        for (const starter of starters) stops.push(await starter());
      } catch (error) {
        isClosed = true;
        const failures = await drain();
        throw failures.length ? new AggregateError([error, ...failures], "后台服务启动及回滚失败") : error;
      }
    })();
    return starting;
  };
  const close = (): Promise<void> => {
    isClosed = true;
    closing ??= (async () => {
      // 启动错误已由start调用者处理；仍等待其回滚完成再清理。
      await starting?.catch(() => undefined);
      const failures = await drain();
      if (failures.length) throw new AggregateError(failures, "后台服务关闭失败");
    })();
    return closing;
  };
  return { start, close };
};
