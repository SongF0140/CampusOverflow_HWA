import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as httpFetch } from "undici";
import { checkSignal, waitForSignal, withUpstreamDeadline } from "../loop/abort.js";

export interface PinnedAddress { address: string; family: number }
export interface PublicPage { url: string; body: string; contentType: string }
export interface FetchDependencies {
  lookup?: (host: string) => Promise<PinnedAddress[]>;
  request?: (url: URL, address: PinnedAddress, signal: AbortSignal) => Promise<Response>;
}
const MAX_BYTES = 512_000;
const denied = () => new Error("网页地址或响应不符合公开只读检索策略");

export const isPublicIp = (address: string): boolean => {
  try { return ipaddr.process(address).range() === "unicast"; }
  catch { return false; }
};

export const parsePublicUrl = (raw: string): URL => {
  if (raw.length > 2048) throw denied();
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port
    || (!isIP(host) && (!host.includes(".") || /\.(?:local|localhost|internal|test|invalid|onion)\.?$/.test(host)))
    || (isIP(host) && !isPublicIp(host))
    || [...url.searchParams.keys()].some(key => /^(?:password|passwd|secret|token|access_token|api_key|authorization|cookie)$/i.test(key))) throw denied();
  url.hash = "";
  return url;
};

export const readBoundedText = async (response: Pick<Response, "headers" | "body">): Promise<string> => {
  if (Number(response.headers.get("content-length") ?? "0") > MAX_BYTES) { await response.body?.cancel(); throw denied(); }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw denied();
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
};

/** 自定义lookup只返回已核验的IP，TLS仍按原主机名验证；不读取环境代理或携带Cookie。 */
const pinnedRequest = async (url: URL, address: PinnedAddress, signal: AbortSignal): Promise<Response> => {
  const dispatcher = new Agent({ connect: { autoSelectFamily: false,
    lookup: (_host, _options, callback) => callback(null, address.address, address.family) } });
  try {
    const response = await httpFetch(url, { dispatcher, signal, redirect: "manual", method: "GET",
      headers: { accept: "text/markdown,text/html,text/plain;q=0.9", "user-agent": "CampusOverflow-WebReader/1.0" } });
    const body = await readBoundedText(response as unknown as Response);
    return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status,
      headers: Object.fromEntries(response.headers.entries()) });
  } finally { await dispatcher.close(); }
};

export const fetchPublicPage = async (raw: string, parent?: AbortSignal, deps: FetchDependencies = {}): Promise<PublicPage> =>
  withUpstreamDeadline(parent, async signal => {
    let url = parsePublicUrl(raw);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      checkSignal(signal);
      const addresses = await waitForSignal(signal, () => (deps.lookup ?? (host => dnsLookup(host, { all: true })))(url.hostname.replace(/^\[|\]$/g, "")));
      if (!addresses.length || addresses.some(address => !isPublicIp(address.address))) throw denied();
      const address = addresses.find(item => item.family === 4) ?? addresses[0];
      const response = await waitForSignal(signal, () => (deps.request ?? pinnedRequest)(url, address, signal));
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || redirects === 3) throw denied();
        url = parsePublicUrl(new URL(location, url).href); continue;
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0].toLowerCase() ?? "";
      if (!response.ok || !/^(?:text\/(?:html|plain|markdown)|application\/xhtml\+xml)$/.test(contentType)) {
        await response.body?.cancel(); throw denied();
      }
      return { url: url.href, body: await waitForSignal(signal, () => readBoundedText(response)), contentType };
    }
    throw denied();
  }, 20_000);
