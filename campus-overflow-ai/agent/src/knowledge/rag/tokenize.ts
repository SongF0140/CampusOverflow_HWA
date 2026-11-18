/**
 * 轻量分词：中文双字 n-gram + 拉丁/数字标识符。
 * 目的是不引入原生分词依赖也能检索课程术语；精确标识符（错误码、版本号）保留原样。
 */

const LATIN_TOKEN = /[a-z0-9]+(?:[._/#:-][a-z0-9]+)*/g;
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff]+/g;

export const normalizeForSearch = (text: string): string =>
  text.normalize("NFKC").toLowerCase();

/** 返回可重复的 token 序列，供 BM25 统计词频。 */
export const tokenize = (text: string): string[] => {
  const normalized = normalizeForSearch(text);
  const tokens: string[] = [];
  for (const match of normalized.matchAll(LATIN_TOKEN)) tokens.push(match[0]);
  for (const match of normalized.matchAll(CJK_RUN)) {
    const run = match[0];
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
  }
  return tokens;
};

/** 错误码、版本号、路径等精确标识：含数字或分隔符。 */
export const isExactIdentifier = (token: string): boolean =>
  token.length >= 3 && /[0-9._/#:-]/.test(token);
