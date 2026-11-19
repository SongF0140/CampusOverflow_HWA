/**
 * 轻量 HNSW：余弦相似度、内存索引、可配置 M/efConstruction/efSearch。
 * 选型依据 D-030；规模面向 1～10 本教材，不引入独立向量数据库。
 */

import type { HnswOptions } from "./types.js";

interface Node {
  id: number;
  vector: Float64Array;
  level: number;
  neighbors: number[][];
}

interface Candidate {
  id: number;
  score: number;
}

export interface HnswSearchHit {
  id: number;
  score: number;
}

const dot = (left: Float64Array, right: Float64Array): number => {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
};

const normalize = (vector: ArrayLike<number>, dimensions: number): Float64Array => {
  if (vector.length !== dimensions) {
    throw new Error(`向量维度不一致：期望 ${dimensions}，实际 ${vector.length}`);
  }
  const result = new Float64Array(dimensions);
  let squared = 0;
  for (let index = 0; index < dimensions; index += 1) {
    const value = vector[index];
    if (!Number.isFinite(value)) throw new Error("向量包含非有限数值");
    result[index] = value;
    squared += value * value;
  }
  if (squared > 0) {
    const length = Math.sqrt(squared);
    for (let index = 0; index < dimensions; index += 1) result[index] /= length;
  }
  return result;
};

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

const insertDescending = (items: Candidate[], item: Candidate): void => {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle].score >= item.score) low = middle + 1;
    else high = middle;
  }
  items.splice(low, 0, item);
};

export class HnswIndex {
  readonly dimensions: number;
  private readonly m: number;
  private readonly efConstruction: number;
  private readonly defaultEfSearch: number;
  private readonly levelScale: number;
  private readonly random: () => number;
  private readonly nodes: Node[] = [];
  private entryPoint: number | null = null;
  private maxLevel = -1;

  constructor(options: HnswOptions) {
    if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
      throw new Error("HNSW 维度必须是正整数");
    }
    this.dimensions = options.dimensions;
    this.m = options.m ?? 16;
    this.efConstruction = options.efConstruction ?? 200;
    this.defaultEfSearch = options.efSearch ?? 64;
    if (!Number.isInteger(this.m) || this.m < 2 || this.m > 64) {
      throw new Error("HNSW M 必须是 2～64 的整数");
    }
    if (!Number.isInteger(this.efConstruction) || this.efConstruction < 10 || this.efConstruction > 1000) {
      throw new Error("HNSW efConstruction 必须是 10～1000 的整数");
    }
    if (!Number.isInteger(this.defaultEfSearch) || this.defaultEfSearch < 10 || this.defaultEfSearch > 1000) {
      throw new Error("HNSW efSearch 必须是 10～1000 的整数");
    }
    this.levelScale = 1 / Math.log(this.m);
    this.random = mulberry32(options.seed ?? 42);
  }

  get size(): number {
    return this.nodes.length;
  }

  /** 返回内部数值 id；调用方负责维护 chunkId 映射。 */
  add(vector: ArrayLike<number>): number {
    const normalized = normalize(vector, this.dimensions);
    const id = this.nodes.length;
    const level = this.randomLevel();
    const node: Node = {
      id,
      vector: normalized,
      level,
      neighbors: Array.from({ length: level + 1 }, () => []),
    };
    this.nodes.push(node);
    if (this.entryPoint === null) {
      this.entryPoint = id;
      this.maxLevel = level;
      return id;
    }

    let current = this.entryPoint;
    for (let layer = this.maxLevel; layer > level; layer -= 1) {
      current = this.greedyClosest(normalized, current, layer);
    }
    for (let layer = Math.min(level, this.maxLevel); layer >= 0; layer -= 1) {
      const candidates = this.searchLayer(normalized, [current], this.efConstruction, layer);
      const selected = candidates.slice(0, this.m).map(candidate => candidate.id);
      node.neighbors[layer] = selected;
      for (const neighborId of selected) {
        const neighbor = this.nodes[neighborId];
        const links = neighbor.neighbors[layer] ?? [];
        links.push(id);
        neighbor.neighbors[layer] = links.length > this.m
          ? this.prune(neighbor.vector, links)
          : links;
      }
      if (candidates[0]) current = candidates[0].id;
    }
    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPoint = id;
    }
    return id;
  }

  search(query: ArrayLike<number>, k: number, efSearch = this.defaultEfSearch): HnswSearchHit[] {
    if (!Number.isInteger(k) || k <= 0) throw new Error("HNSW 返回条数必须是正整数");
    if (!Number.isInteger(efSearch) || efSearch < k || efSearch > 1000) {
      throw new Error("HNSW efSearch 必须是不小于 k 且不超过 1000 的整数");
    }
    if (this.entryPoint === null) return [];
    const normalized = normalize(query, this.dimensions);
    let current = this.entryPoint;
    for (let layer = this.maxLevel; layer > 0; layer -= 1) {
      current = this.greedyClosest(normalized, current, layer);
    }
    return this.searchLayer(normalized, [current], efSearch, 0)
      .slice(0, k)
      .map(candidate => ({ id: candidate.id, score: candidate.score }));
  }

  private randomLevel(): number {
    const value = Math.max(this.random(), Number.EPSILON);
    return Math.floor(-Math.log(value) * this.levelScale);
  }

  private greedyClosest(query: Float64Array, start: number, layer: number): number {
    let current = start;
    let currentScore = dot(query, this.nodes[current].vector);
    let changed = true;
    while (changed) {
      changed = false;
      for (const neighborId of this.nodes[current].neighbors[layer] ?? []) {
        const score = dot(query, this.nodes[neighborId].vector);
        if (score > currentScore) {
          current = neighborId;
          currentScore = score;
          changed = true;
        }
      }
    }
    return current;
  }

  private searchLayer(
    query: Float64Array,
    entryPoints: readonly number[],
    ef: number,
    layer: number,
  ): Candidate[] {
    const visited = new Set<number>();
    const results: Candidate[] = [];
    const candidates: Candidate[] = [];
    for (const id of entryPoints) {
      if (visited.has(id)) continue;
      visited.add(id);
      const candidate = { id, score: dot(query, this.nodes[id].vector) };
      insertDescending(results, candidate);
      insertDescending(candidates, candidate);
    }
    while (results.length > ef) results.pop();

    while (candidates.length > 0) {
      const best = candidates.shift();
      if (!best) break;
      const worst = results[results.length - 1];
      if (results.length >= ef && worst && best.score < worst.score) break;
      for (const neighborId of this.nodes[best.id].neighbors[layer] ?? []) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const score = dot(query, this.nodes[neighborId].vector);
        const currentWorst = results[results.length - 1];
        if (results.length < ef || (currentWorst && score > currentWorst.score)) {
          const candidate = { id: neighborId, score };
          insertDescending(results, candidate);
          if (results.length > ef) results.pop();
          insertDescending(candidates, candidate);
        }
      }
    }
    return results;
  }

  private prune(vector: Float64Array, ids: readonly number[]): number[] {
    return [...new Set(ids)]
      .sort((left, right) => dot(vector, this.nodes[right].vector) - dot(vector, this.nodes[left].vector))
      .slice(0, this.m);
  }
}
