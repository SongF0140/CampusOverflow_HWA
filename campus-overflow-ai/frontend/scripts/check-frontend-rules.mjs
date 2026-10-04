#!/usr/bin/env node
/**
 * 前端机械自检：把"靠记性"的规则变成脚本（提交前跑 `npm run check:rules`）。
 *
 * 规则来源：docs/前端架构/前端实现清单.md（每条都对应一次真实踩坑）
 *   1. 禁止把 status 写成 "unresolved"：后端问题状态只有 published / resolved（qa/domain.py）
 *      （注意 unresolved 是合法的**查询参数名**，只检查 status 位置）
 *   2. 禁止硬编码色值：必须用 design token（唯一例外 src/app/design/page.tsx 的色卡）
 *   3. 禁止英文 placeholder：界面文案必须简体中文（C-01）
 *   4. href 指向的页面必须存在（提示级，避免挂死链）
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const srcRoot = join(frontendRoot, "src");
const appRoot = join(srcRoot, "app");

const errors = [];
const warnings = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sourceFiles = walk(srcRoot).filter((file) => /\.(ts|tsx)$/.test(file));

// ---------- 规则 1：status 不得写 "unresolved" ----------
// 只匹配 status 字段/比较位置，避免误伤后端合法的查询参数名 unresolved=true
const badStatus = /status\s*[:=]\s*"unresolved"|"status"\s*:\s*"unresolved"/;
for (const file of sourceFiles) {
  const text = readFileSync(file, "utf8");
  if (badStatus.test(text)) {
    errors.push(
      `${relative(frontendRoot, file)}: status 被写成 "unresolved"；后端只有 published / resolved（见 src/shared/constants/domain.ts）`,
    );
  }
}

// ---------- 规则 2：禁止硬编码色值（/design 色卡例外）----------
const colorAllowList = [join(appRoot, "design", "page.tsx")];
for (const file of sourceFiles) {
  if (colorAllowList.includes(file)) continue;
  const text = readFileSync(file, "utf8");
  const hit = text.match(/#[0-9A-Fa-f]{6}\b/);
  if (hit) {
    errors.push(
      `${relative(frontendRoot, file)}: 出现硬编码色值 ${hit[0]}；请改用 design token（docs/前端架构/设计系统.md）`,
    );
  }
}

// ---------- 规则 3：禁止英文 placeholder ----------
for (const file of sourceFiles.filter((f) => f.endsWith(".tsx"))) {
  const text = readFileSync(file, "utf8");
  const hit = text.match(/placeholder="[A-Za-z]/);
  if (hit) {
    errors.push(`${relative(frontendRoot, file)}: placeholder 以英文字母开头，界面文案需为简体中文（C-01）`);
  }
}

// ---------- 规则 4：href 目标页面必须存在（提示级）----------
const existingRoutes = new Set();
for (const file of walk(appRoot)) {
  if (!/page\.tsx$/.test(file)) continue;
  const dir = relative(appRoot, dirname(file)).replace(/\\/g, "/");
  existingRoutes.add(dir === "" ? "/" : `/${dir}`);
}

function routeExists(target) {
  if (existingRoutes.has(target)) return true;
  // 动态路由：/questions/123 → /questions/[id]
  const segments = target.split("/").filter(Boolean);
  for (let i = 0; i < segments.length; i += 1) {
    const prefix = `/${segments.slice(0, i).join("/")}${i > 0 ? "/" : ""}`;
    const dir = join(appRoot, segments.slice(0, i).join("/"));
    if (!existsSync(dir)) continue;
    const hasDynamic = readdirSync(dir, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && entry.name.startsWith("[") && entry.name.endsWith("]"),
    );
    if (hasDynamic) return true;
    void prefix;
  }
  return false;
}

// 已排期但尚未实现的页面：出现链接时跳过检查（页面落地后请从本表移除）
// 目前为空：所有已挂链接的页面（/、/questions/**、/notifications、/me、/users/**、/403…）都已实现
const PLANNED_ROUTES = new Set([]);

for (const file of sourceFiles.filter((f) => f.endsWith(".tsx"))) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/href="(\/[^"?#]*)"/g)) {
    const target = match[1];
    if (PLANNED_ROUTES.has(target)) continue;
    if (!routeExists(target)) {
      warnings.push(`${relative(frontendRoot, file)}: href="${target}" 未找到对应页面（确认是否死链）`);
    }
  }
}

// ---------- 输出 ----------
for (const warning of warnings) console.warn(`[warn] ${warning}`);
for (const error of errors) console.error(`[error] ${error}`);

if (errors.length > 0) {
  console.error(`\n前端自检未通过：${errors.length} 个错误、${warnings.length} 个提示`);
  process.exit(1);
}
console.log(`前端自检通过（${warnings.length} 个提示）`);
