import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { checkSignal } from "../loop/abort.js";
import { fetchPublicPage, type PublicPage } from "./public-fetch.js";
import { pageText } from "./page-text.js";

const runFile = promisify(execFile);
export interface WebPage { url: string; content: string }
export interface ReaderInvocation { executable: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string; signal?: AbortSignal; timeoutMs?: number }
export type BrowserRunner = (invocation: ReaderInvocation) => Promise<string>;
const execute: BrowserRunner = async request => (await runFile(request.executable, request.args, {
  env: request.env, cwd: request.cwd, signal: request.signal, timeout: request.timeoutMs ?? 20_000, maxBuffer: 1_000_000, windowsHide: true,
})).stdout;

/** 显式配置替代用户全局配置；子进程不继承服务、模型、代理或浏览器凭据。 */
const prepareReader = async (folder: string, bridge: string, signal?: AbortSignal): Promise<ReaderInvocation> => {
  const config = join(folder, "config.json"); const policy = join(folder, "policy.json");
  await writeFile(config, JSON.stringify({ maxOutput: 20_000 }));
  await writeFile(policy, JSON.stringify({ default: "deny", allow: ["launch", "read", "close"] }));
  const packagePath = createRequire(import.meta.url).resolve("agent-browser/package.json");
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  const platform = process.platform === "linux" && !report.header?.glibcVersionRuntime ? "linux-musl" : process.platform;
  const binary = join(dirname(packagePath), "bin", `agent-browser-${platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`);
  if (!existsSync(binary)) throw new Error("当前平台的agent-browser二进制未安装");
  return { executable: binary, cwd: folder, signal,
    args: ["--config", config, "--action-policy", policy,
      "--session", `web-${randomUUID()}`, "--json", "read", bridge, "--require-md", "--timeout", "15000"],
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: folder, TMP: folder,
      AGENT_BROWSER_SOCKET_DIR: folder } };
};

/** 只将已校验的公开正文桥接给read；CLI不直接访问外部URL或启动Chrome。 */
export const extractWithBrowser = async (page: PublicPage, signal?: AbortSignal, runner: BrowserRunner = execute): Promise<WebPage> => {
  checkSignal(signal);
  const text = pageText(page);
  if (!text.trim()) throw new Error("网页没有可读取的文本");
  const folder = await mkdtemp(join(tmpdir(), "campus-web-reader-"));
  let invocation: ReaderInvocation | undefined;
  const path = `/${randomUUID()}`;
  const server = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== path) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" }).end(text);
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("网页读取桥接未就绪");
    invocation = await prepareReader(folder, `http://127.0.0.1:${address.port}${path}`, signal);
    const output = await runner(invocation);
    checkSignal(signal);
    const result = z.object({ success: z.literal(true), data: z.object({ content: z.string().min(1), source: z.literal("accept-markdown") }) }).parse(JSON.parse(output));
    return { url: page.url, content: result.data.content.slice(0, 12_000) };
  } catch {
    checkSignal(signal); throw new Error("网页正文读取失败");
  } finally {
    let closeFailed = false;
    if (invocation) {
      const args = [...invocation.args.slice(0, invocation.args.indexOf("read")), "close"];
      await runner({ ...invocation, args, signal: undefined, timeoutMs: 5000 }).then(output => {
        z.object({ success: z.literal(true), data: z.object({ closed: z.literal(true) }) }).parse(JSON.parse(output));
      }).catch(() => {
        closeFailed = true;
        console.error(JSON.stringify({ event: "web_reader_close_failed" }));
      });
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    try { await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch { closeFailed = true; console.error(JSON.stringify({ event: "web_reader_temp_cleanup_failed" })); }
    if (closeFailed) throw new Error("网页正文读取失败");
  }
};

export const readWithBrowser = async (url: string, signal?: AbortSignal): Promise<WebPage> =>
  extractWithBrowser(await fetchPublicPage(url, signal), signal);
