import "dotenv/config";
import { resolveNitroPort } from "./listen-port.mjs";

/** @param {NodeJS.ProcessEnv} env */
export const applyRuntimeEnvironment = (env) => {
  const port = resolveNitroPort({ ...env, NITRO_PORT: env.AGENT_PORT ?? env.NITRO_PORT }, "8787");
  env.PORT = port;
  env.NITRO_PORT = port;
};

applyRuntimeEnvironment(process.env);
