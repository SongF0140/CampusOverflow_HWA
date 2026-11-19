import { z } from "zod";
import type { ToolEvidence } from "../observability/run-evidence.js";

const Source = z.object({ url: z.string() });
const Search = z.object({ kind: z.literal("external_web"), sources: z.array(Source) });
const Page = Source.extend({ kind: z.literal("external_web") });
const canonical = (raw: string): string => {
  const url = new URL(raw);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid_web_source");
  url.hash = ""; return url.href;
};

/** 只核对真实工具URL，不声称能程序证明网页内容或自然语言结论。 */
export const checkWebCitations = (text: string, evidence: ToolEvidence[]): Set<string> => {
  const active = evidence.some(item => ["searchWeb", "readWebPage", "webRetrievalAttempt"].includes(item.toolName));
  const observed = new Set<string>(); const cited = new Set<string>();
  if (!active) return cited;
  for (const item of evidence) {
    if (item.toolName === "searchWeb") {
      const result = Search.safeParse(item.result);
      if (result.success) for (const source of result.data.sources) observed.add(canonical(source.url));
    } else if (item.toolName === "readWebPage") {
      const result = Page.safeParse(item.result);
      if (result.success) observed.add(canonical(result.data.url));
    }
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const raw = match[0].replace(/[。！？；，、.,;!?）]+$/, "");
    if (!observed.has(canonical(raw))) throw new Error("unobserved_web_source");
    cited.add(raw);
  }
  if (observed.size > 0 && cited.size === 0) throw new Error("missing_web_citation");
  return cited;
};
