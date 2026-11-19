import { defineHandler } from "nitro";
import { extractWithBrowser } from "../../../src/web/browser-reader.js";

// 仅独立冒烟构建注册，正式构建没有此入口。
export default defineHandler(async () => extractWithBrowser({ url: "https://example.com/public-reference",
  body: "<html><body><main><h1>Public reference</h1><p>BROWSER_ARTIFACT_SMOKE</p><script>throw new Error('SCRIPT_MUST_BE_REMOVED')</script></main></body></html>", contentType: "text/html" }));
