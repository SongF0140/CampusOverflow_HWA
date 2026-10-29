import { createInternalClient, resolveInternalConfig } from "../internal-client.js";
import { asTraceId } from "../types/index.js";
import { createKnowledgeCatalog, type KnowledgeCatalog } from "./catalog.js";

let catalog: KnowledgeCatalog | undefined;
let configuredRoot: string | undefined;

/** 系统目录不捕获用户 JWT；课程读取另经当前用户后端校验。 */
export const getKnowledgeCatalog = (): KnowledgeCatalog | undefined => {
  const root = process.env.KNOWLEDGE_ROOT;
  if (!root) return undefined;
  if (root !== configuredRoot) {
    catalog?.stop();
    configuredRoot = root;
    catalog = createKnowledgeCatalog({ root, trustedTags: () => createInternalClient({
      ...resolveInternalConfig(), fetchImpl: fetch,
    }).fetchCatalogTags(asTraceId(`catalog-${crypto.randomUUID()}`)),
    onError: () => console.error(JSON.stringify({ event: "knowledge_catalog_refresh_failed" })) });
  }
  return catalog;
};
