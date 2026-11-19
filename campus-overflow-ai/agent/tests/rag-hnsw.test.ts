// HNSW：与暴力余弦检索对比召回、确定性与参数校验。
import { describe, expect, it } from "vitest";

import { HnswIndex } from "../src/knowledge/rag/hnsw.js";

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const vectorOf = (random: () => number, dimensions: number): number[] =>
  Array.from({ length: dimensions }, () => random() * 2 - 1);

const cosine = (left: readonly number[], right: readonly number[]): number => {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / Math.max(Math.sqrt(leftNorm * rightNorm), Number.EPSILON);
};

const bruteForce = (vectors: readonly number[][], query: number[], k: number): number[] =>
  vectors
    .map((vector, index) => ({ index, score: cosine(vector, query) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, k)
    .map(item => item.index);

describe("HNSW 索引", () => {
  it("300 条随机向量的 Recall@10 不低于 0.9", () => {
    const random = mulberry32(20261118);
    const vectors = Array.from({ length: 300 }, () => vectorOf(random, 32));
    const index = new HnswIndex({ dimensions: 32, m: 16, efConstruction: 200, efSearch: 100, seed: 7 });
    vectors.forEach(vector => index.add(vector));
    let hit = 0;
    let total = 0;
    for (let queryIndex = 0; queryIndex < 30; queryIndex += 1) {
      const query = vectorOf(random, 32);
      const expected = new Set(bruteForce(vectors, query, 10));
      const actual = index.search(query, 10, 100).map(item => item.id);
      hit += actual.filter(id => expected.has(id)).length;
      total += expected.size;
    }
    expect(hit / total).toBeGreaterThanOrEqual(0.9);
  });

  it("相同种子与插入顺序下结果一致", () => {
    const random = mulberry32(42);
    const vectors = Array.from({ length: 80 }, () => vectorOf(random, 16));
    const build = (): HnswIndex => {
      const index = new HnswIndex({ dimensions: 16, seed: 9 });
      vectors.forEach(vector => index.add(vector));
      return index;
    };
    const query = vectorOf(random, 16);
    expect(build().search(query, 5)).toEqual(build().search(query, 5));
  });

  it("拒绝维度不一致、非法 k 与非法参数", () => {
    const index = new HnswIndex({ dimensions: 4 });
    expect(() => index.add([1, 2, 3])).toThrow("维度不一致");
    expect(() => new HnswIndex({ dimensions: 4, m: 1 })).toThrow("M");
    expect(() => new HnswIndex({ dimensions: 4, efSearch: 5 })).toThrow("efSearch");
    index.add([1, 0, 0, 0]);
    expect(() => index.search([1, 0, 0, 0], 0)).toThrow("正整数");
    expect(() => index.search([1, 0, 0, 0], 20, 5)).toThrow("efSearch");
  });

  it("空索引返回空结果", () => {
    const index = new HnswIndex({ dimensions: 8 });
    expect(index.search([1, 0, 0, 0, 0, 0, 0, 0], 3)).toEqual([]);
    expect(index.size).toBe(0);
  });
});
