import ReactMarkdown from "react-markdown";

/**
 * 正文渲染：后端入库前已用 bleach 剥离 HTML 标签（X-03），
 * react-markdown 默认也不解析原始 HTML，因此这里不需要额外清洗。
 */
export function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="text-[15px] leading-[1.75] text-ink [&_a]:text-brand [&_a]:underline [&_code]:rounded-sm [&_code]:bg-panel [&_code]:px-1 [&_h1]:mb-3 [&_h1]:text-[20px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-[17px] [&_h2]:font-semibold [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-panel [&_pre]:p-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
