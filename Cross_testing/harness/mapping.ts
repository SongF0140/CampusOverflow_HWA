/** gold quote 到不同切分 chunk 的覆盖判断。 */

import type { VariantHit } from "./types.js";

export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\s，。！？；：、,.!?;:'"“”‘’（）()【】[\]{}<>《》—-]/g, "");

const bigrams = (text: string): Set<string> => {
  const result = new Set<string>();
  for (let index = 0; index < text.length - 1; index += 1) result.add(text.slice(index, index + 2));
  return result;
};

/** 先判包含；跨 chunk 边界时用双字重合率兜底。 */
export const covers = (text: string, quote: string): boolean => {
  const normalizedText = normalize(text);
  const normalizedQuote = normalize(quote);
  if (!normalizedQuote) return false;
  if (normalizedText.includes(normalizedQuote)) return true;
  const quoteBigrams = bigrams(normalizedQuote);
  if (quoteBigrams.size === 0) return false;
  const textBigrams = bigrams(normalizedText);
  let overlap = 0;
  for (const gram of quoteBigrams) if (textBigrams.has(gram)) overlap += 1;
  return overlap / quoteBigrams.size >= 0.6;
};

export const coversAny = (hits: readonly VariantHit[], quote: string): boolean =>
  hits.some(hit => covers(hit.chunk.text, quote));
