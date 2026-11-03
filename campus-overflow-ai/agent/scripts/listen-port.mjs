/** Nitro直接启动按NITRO_PORT→PORT→3000；项目预加载器先规范化AGENT_PORT。 */
/** @param {NodeJS.ProcessEnv} env @param {string} fallback */
export const resolveNitroPort = (env, fallback = "3000") => {
  const port = env.NITRO_PORT ?? env.PORT ?? fallback;
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Agent端口必须为1～65535的整数");
  return String(Number(port));
};
