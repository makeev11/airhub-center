import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Safe read-only rendering: never fetch embedded images or enable raw HTML. */
export function KnowledgeMarkdown({ text }: { text: string }) {
  return (
    <div className="space-y-3 break-words text-sm leading-relaxed [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          img: () => null,
          a: ({ children }) => <span className="underline">{children}</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
