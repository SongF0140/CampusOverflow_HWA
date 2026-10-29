import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
export const portable = (path: string): string => path.split(sep).join("/");
const inside = (root: string, path: string): boolean => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

/** 路径受根目录约束；不接受 URL、绝对路径、空字节或根外符号链接。 */
export const safeRead = async (root: string, path: string, maxBytes: number): Promise<string> => {
  if (isAbsolute(path) || /[:\0]/.test(path)) throw new Error("invalid path");
  const target = resolve(root, path);
  if (!inside(root, target)) throw new Error("invalid path");
  const canonical = await realpath(target);
  if (!inside(root, canonical)) throw new Error("invalid path");
  const info = await stat(canonical);
  if (!info.isFile() || info.size > maxBytes) throw new Error("invalid size");
  const content = await readFile(canonical, "utf8");
  if (Buffer.byteLength(content, "utf8") > maxBytes) throw new Error("invalid size");
  return content;
};

export const cardFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    const canonical = await realpath(folder);
    if (!inside(root, canonical)) throw new Error("invalid directory");
    for (const entry of await readdir(canonical, { withFileTypes: true })) {
      // 目录树中的符号链接不跟随，避免环路和根外内容。
      if (entry.isSymbolicLink()) continue;
      const path = resolve(canonical, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(portable(relative(root, path)));
      if (files.length > 10_000) throw new Error("too many cards");
    }
  };
  await walk(resolve(root, "cards"));
  return files.sort();
};
