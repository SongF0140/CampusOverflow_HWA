import { parseHTML } from "linkedom";
import type { PublicPage } from "./public-fetch.js";

/** 非执行DOM解析器不加载资源；只将惰性文本交给浏览器Markdown读取路径。 */
export const pageText = (page: PublicPage): string => {
  if (!/html/.test(page.contentType)) return page.body.slice(0, 16_000);
  const { document } = parseHTML(page.body);
  for (const element of document.querySelectorAll("script,style,noscript,template,iframe,object,embed,form,nav,footer")) element.remove();
  const root = document.querySelector("main,article") ?? document.body;
  return (root?.innerText || document.documentElement?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 16_000);
};
