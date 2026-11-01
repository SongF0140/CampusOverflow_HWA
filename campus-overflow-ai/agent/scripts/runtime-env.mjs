import "dotenv/config";

/** @param {NodeJS.ProcessEnv} env */
export const applyRuntimeEnvironment = (env) => {
  const port = env.AGENT_PORT ?? env.NITRO_PORT ?? env.PORT ?? "8787";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Agent端口必须为1～65535的整数");
  env.PORT = port;
  env.NITRO_PORT = port;
};

applyRuntimeEnvironment(process.env);
