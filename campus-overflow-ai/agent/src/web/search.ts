import { z } from "zod";
import { checkSignal, withUpstreamDeadline } from "../loop/abort.js";
import { readBoundedText } from "./public-fetch.js";

export interface WebSource { title: string; url: string; content: string }
const ResponseSchema = z.object({ results: z.array(z.object({
  title: z.string().max(2000), url: z.string().max(2048), content: z.string().max(100_000),
})).max(20) });

/** 端点固定，不接受模型传入URL、身份或密钥；仅发送提炼后的查询词。 */
export const searchTavily = async (query: string, apiKey: string, parent?: AbortSignal,
  request: typeof fetch = fetch): Promise<WebSource[]> => withUpstreamDeadline(parent, async signal => {
  try {
  const response = await request("https://api.tavily.com/search", { method: "POST", redirect: "error", signal,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 5, include_answer: false,
      include_raw_content: false, include_images: false, auto_parameters: false, safe_search: true }) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("网络搜索服务暂不可用"); }
  const parsed = ResponseSchema.parse(JSON.parse(await readBoundedText(response)));
  return parsed.results.slice(0, 5).map(item => ({ title: item.title.slice(0, 300), url: item.url, content: item.content.slice(0, 1500) }));
  } catch {
    checkSignal(signal); throw new Error("网络搜索服务暂不可用");
  }
}, 15_000);
