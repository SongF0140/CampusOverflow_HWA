/**
 * 从 specs/tasks.md 的 git 历史生成任务燃尽图（累计口径）。
 *
 * 用法：node wiki/tools/burndown.mjs
 * 产物：wiki/assets/burndown.svg，并回填 wiki/项目燃尽.md 中 markers 之间的数据表。
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const TASKS_PATH = "specs/tasks.md";
const PAGE = resolve(root, "wiki/项目燃尽.md");
const SVG = resolve(root, "wiki/assets/burndown.svg");
const START_MARK = "<!-- burndown:start -->";
const END_MARK = "<!-- burndown:end -->";

const git = args =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

const CHECKBOX = /^\s*[-*]\s*\[([ xX])\]\s+/;

const countTasks = text => {
  let done = 0;
  let total = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!CHECKBOX.test(line)) continue;
    total += 1;
    if (/^\s*[-*]\s*\[[xX]\]/.test(line)) done += 1;
  }
  return { done, total };
};

const readHistory = () => {
  const raw = git(["log", "--format=%H|%aI", "--", TASKS_PATH]).trim();
  const commits = raw
    ? raw.split("\n").map(line => {
        const [sha, date] = line.split("|");
        return { sha, date: date.slice(0, 10) };
      })
    : [];
  commits.reverse();

  const byDate = new Map();
  for (const commit of commits) {
    try {
      const text = git(["show", `${commit.sha}:${TASKS_PATH}`]);
      const { done, total } = countTasks(text);
      byDate.set(commit.date, { date: commit.date, done, total });
    } catch {
      // 该提交里任务清单不存在，跳过，不阻断其余历史。
    }
  }

  const workingCopy = resolve(root, TASKS_PATH);
  if (existsSync(workingCopy)) {
    const { done, total } = countTasks(readFileSync(workingCopy, "utf8"));
    const today = new Date().toISOString().slice(0, 10);
    byDate.set(today, { date: today, done, total });
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

const toDay = date => Math.round(new Date(`${date}T00:00:00Z`).getTime() / 86_400_000);

const escapeXml = text => text.replace(/[<>&]/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char]);

const renderSvg = points => {
  const width = 880;
  const height = 400;
  const pad = { left: 62, right: 30, top: 48, bottom: 58 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const first = toDay(points[0].date);
  const last = toDay(points.at(-1).date);
  const span = Math.max(1, last - first);
  const maxY = Math.max(...points.map(point => point.total), 1);
  const stepY = Math.max(1, Math.ceil(maxY / 5 / 10) * 10);

  const x = point => pad.left + ((toDay(point.date) - first) / span) * plotWidth;
  const y = value => pad.top + plotHeight - (value / (stepY * 5)) * plotHeight;

  const path = key =>
    points
      .map((point, index) => `${index === 0 ? "M" : "L"}${x(point).toFixed(1)},${y(point[key]).toFixed(1)}`)
      .join(" ");

  const grid = Array.from({ length: 6 }, (_, index) => {
    const value = stepY * index;
    return `<line x1="${pad.left}" y1="${y(value).toFixed(1)}" x2="${width - pad.right}" y2="${y(value).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`
      + `<text x="${pad.left - 10}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b7280">${value}</text>`;
  }).join("\n    ");

  const tickCount = 6;
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const target = first + (span * index) / (tickCount - 1);
    const nearest = points.reduce((best, point) =>
      Math.abs(toDay(point.date) - target) < Math.abs(toDay(best.date) - target) ? point : best,
    );
    return `<text x="${x(nearest).toFixed(1)}" y="${height - pad.bottom + 20}" text-anchor="middle" font-size="11" fill="#6b7280">${nearest.date.slice(5)}</text>`;
  }).join("\n    ");

  const lastPoint = points.at(-1);
  const endLabel = (key, color, offset) =>
    `<text x="${(x(lastPoint) + 6).toFixed(1)}" y="${(y(lastPoint[key]) + offset).toFixed(1)}" font-size="11" fill="${color}">${lastPoint[key]}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="任务燃尽图">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${pad.left}" y="26" font-size="14" font-weight="600" fill="#111827">任务燃尽（累计口径）</text>
  <text x="${width - pad.right}" y="26" text-anchor="end" font-size="11" fill="#9ca3af">数据：specs/tasks.md 的 git 历史</text>
  <g font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
    ${grid}
    ${ticks}
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotHeight}" stroke="#d1d5db" stroke-width="1"/>
    <line x1="${pad.left}" y1="${pad.top + plotHeight}" x2="${width - pad.right}" y2="${pad.top + plotHeight}" stroke="#d1d5db" stroke-width="1"/>
    <path d="${path("total")}" fill="none" stroke="#9ca3af" stroke-width="2" stroke-dasharray="5 4"/>
    <path d="${path("done")}" fill="none" stroke="#059669" stroke-width="2.5"/>
    <path d="${path("remaining")}" fill="none" stroke="#ea580c" stroke-width="2.5"/>
    ${endLabel("total", "#6b7280", -6)}
    ${endLabel("done", "#059669", 14)}
    ${endLabel("remaining", "#ea580c", 14)}
    <g font-size="11" fill="#374151">
      <line x1="${pad.left + 8}" y1="${height - 22}" x2="${pad.left + 28}" y2="${height - 22}" stroke="#9ca3af" stroke-width="2" stroke-dasharray="5 4"/>
      <text x="${pad.left + 34}" y="${height - 18}">总任务</text>
      <line x1="${pad.left + 84}" y1="${height - 22}" x2="${pad.left + 104}" y2="${height - 22}" stroke="#059669" stroke-width="2.5"/>
      <text x="${pad.left + 110}" y="${height - 18}">累计完成</text>
      <line x1="${pad.left + 176}" y1="${height - 22}" x2="${pad.left + 196}" y2="${height - 22}" stroke="#ea580c" stroke-width="2.5"/>
      <text x="${pad.left + 202}" y="${height - 18}">剩余</text>
    </g>
  </g>
</svg>
`;
};

const renderTable = points => {
  const rows = [];
  let previous = null;
  for (const point of points) {
    if (previous && previous.done === point.done && previous.total === point.total) continue;
    rows.push(`| ${point.date} | ${point.total} | ${point.done} | ${point.remaining} |`);
    previous = point;
  }
  return [
    "| 日期 | 总任务 | 累计完成 | 剩余 |",
    "| --- | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
};

const main = () => {
  const points = readHistory().map(point => ({ ...point, remaining: point.total - point.done }));
  if (points.length === 0) {
    console.error("未找到 specs/tasks.md 的历史记录，无法生成燃尽图。");
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(SVG), { recursive: true });
  writeFileSync(SVG, renderSvg(points), "utf8");

  if (existsSync(PAGE)) {
    const page = readFileSync(PAGE, "utf8");
    const start = page.indexOf(START_MARK);
    const end = page.indexOf(END_MARK);
    if (start >= 0 && end > start) {
      const next = `${page.slice(0, start + START_MARK.length)}\n\n${renderTable(points)}\n\n${page.slice(end)}`;
      writeFileSync(PAGE, next, "utf8");
    } else {
      console.warn("wiki/项目燃尽.md 缺少 burndown 标记，仅生成 SVG。");
    }
  }

  const first = points[0];
  const last = points.at(-1);
  console.log(`快照 ${points.length} 个：${first.date} → ${last.date}`);
  console.log(`总任务 ${last.total}，累计完成 ${last.done}，剩余 ${last.remaining}`);
  console.log(`已写入 ${SVG}`);
};

main();
