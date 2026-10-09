import Markdown from "react-markdown";
import type { Components } from "react-markdown";

// 安全口径：不接入 rehype-raw，原始 HTML 一律不渲染（XSS 清洗）
const COMPONENTS: Components = {
  p: ({ children }) => <p className="my-3">{children}</p>,
  h1: ({ children }) => <h1 className="mb-3 mt-6 text-[22px] font-semibold text-ink">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-5 text-[20px] font-semibold text-ink">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-[17px] font-semibold text-ink">{children}</h3>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-brand underline underline-offset-2 transition-colors duration-150 ease-standard hover:text-brand-strong"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-line pl-4 text-ink-muted">{children}</blockquote>
  ),
  // 代码块内的 code 由 pre 的后代选择器统一清掉行内底色
  code: ({ className, children }) => <code className={className}>{children}</code>,
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md border border-line bg-panel p-3 text-[13px] leading-relaxed [&_code]:bg-transparent [&_code]:px-0 [&_code]:py-0">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-6 border-line" />,
};

// Markdown 正文渲染：阅读宽度 ≤720px、行高 1.75（约 72 字符）
export function MarkdownView({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={`max-w-[720px] text-[15px] leading-[1.75] text-ink ${className}`}>
      <Markdown components={COMPONENTS}>{content}</Markdown>
    </div>
  );
}
