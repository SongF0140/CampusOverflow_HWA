import { dirname, resolve } from "node:path";

import { CardMetadataSchema, type KnowledgeCard, type TrustedKnowledgeTag } from "./types.js";

export const parseCard = (id: string, text: string): KnowledgeCard => {
  const sections = text.trim().split(/^## /m);
  if (sections[0] !== "" || sections.length !== 4) throw new Error("invalid sections");
  const content = sections.slice(1).map(section => section.trim());
  const [domain, metadata, summary] = content;
  if (!domain.startsWith("领域名称\n") || !metadata.startsWith("元数据\n") || !summary.startsWith("摘要\n")) {
    throw new Error("invalid sections");
  }
  const name = domain.slice("领域名称\n".length).trim();
  const abstract = summary.slice("摘要\n".length).trim();
  const data = metadata.slice("元数据\n".length).trim().match(/^```json\s*\n([\s\S]*?)\n```$/);
  if (!name || name.length > 200 || !abstract || abstract.length > 4000 || !data) throw new Error("invalid card");
  return { id, domain: name, metadata: CardMetadataSchema.parse(JSON.parse(data[1])), summary: abstract };
};

export const validateTags = (card: KnowledgeCard, tags: readonly TrustedKnowledgeTag[]): void => {
  const ids = new Set(card.metadata.tag_ids);
  if (ids.size !== card.metadata.tag_ids.length || [...ids].some(id => !tags.some(tag =>
    tag.id === id && tag.course_id === card.metadata.course_id && tag.active
      && ["teacher", "textbook"].includes(tag.source)))) throw new Error("invalid tags");
};

/** 显式书签限定读取段，正文须有指回对应卡片的链接。 */
export const bodySection = (root: string, card: KnowledgeCard, body: string): string => {
  const bookmark = `<a id="${card.metadata.body.bookmark}"></a>`;
  const start = body.indexOf(bookmark);
  if (start < 0) throw new Error("missing bookmark");
  const targets = [...body.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)].map(match => match[1].split("#")[0]);
  const directory = dirname(resolve(root, card.metadata.body.path));
  if (!targets.some(target => !/^[a-z]+:/i.test(target) && resolve(directory, target) === resolve(root, card.id))) {
    throw new Error("missing backlink");
  }
  const next = body.indexOf('<a id="', start + bookmark.length);
  return body.slice(start, next === -1 ? undefined : next).trim();
};
