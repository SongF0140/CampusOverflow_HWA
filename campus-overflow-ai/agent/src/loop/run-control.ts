import { RunStoppedError } from "./abort.js";

export const createRunControl = (parent: AbortSignal) => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => controller.abort(new RunStoppedError("cancelled"));
  parent.addEventListener("abort", cancel, { once: true });
  if (parent.aborted) cancel();
  return {
    signal: controller.signal,
    start: () => {
      if (!timer && !controller.signal.aborted) {
        timer = setTimeout(() => controller.abort(new RunStoppedError("timeout")), 180_000);
      }
    },
    cancel,
    dispose: () => { clearTimeout(timer); parent.removeEventListener("abort", cancel); },
  };
};
export type RunControl = ReturnType<typeof createRunControl>;
