import { Fragment, ReactNode } from "react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const INLINE_TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;

function safeHref(rawHref: string) {
  const href = rawHref.trim();
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  return null;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    const token = match[0];

    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`${index}-bold`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`${index}-code`}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = linkMatch ? safeHref(linkMatch[2]) : null;
      nodes.push(
        href ? (
          <a
            key={`${index}-link`}
            href={href}
            className="text-primary hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkMatch![1]}
          </a>
        ) : (
          <Fragment key={`${index}-text`}>{linkMatch?.[1] || token}</Fragment>
        ),
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={`${index}-italic`} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      nodes.push(token);
    }

    cursor = index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export const MarkdownRenderer = ({
  content,
  className = "",
}: MarkdownRendererProps) => {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const headingClass =
        level === 1
          ? "mt-5 mb-3 text-xl font-bold"
          : level === 2
            ? "mt-4 mb-2 text-lg font-semibold"
            : "mt-3 mb-2 text-base font-semibold";
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      blocks.push(
        <Tag
          key={`heading-${index}`}
          className={`${headingClass} text-foreground`}
        >
          {renderInline(heading[2])}
        </Tag>,
      );
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = lines[index].trim().match(/^[-*]\s+(.+)$/);
        if (!item) break;
        items.push(<li key={`bullet-${index}`}>{renderInline(item[1])}</li>);
        index += 1;
      }
      blocks.push(
        <ul
          key={`ul-${index}`}
          className="my-3 list-disc space-y-1.5 pl-5 text-foreground/90"
        >
          {items}
        </ul>,
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = lines[index].trim().match(/^\d+[.)]\s+(.+)$/);
        if (!item) break;
        items.push(<li key={`number-${index}`}>{renderInline(item[1])}</li>);
        index += 1;
      }
      blocks.push(
        <ol
          key={`ol-${index}`}
          className="my-3 list-decimal space-y-1.5 pl-5 text-foreground/90"
        >
          {items}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index].trim();
      if (
        !candidate ||
        /^(#{1,3})\s+/.test(candidate) ||
        /^[-*]\s+/.test(candidate) ||
        /^\d+[.)]\s+/.test(candidate)
      )
        break;
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push(
      <p
        key={`paragraph-${index}`}
        className="mb-3 leading-relaxed text-foreground/90"
      >
        {renderInline(paragraph.join(" "))}
      </p>,
    );
  }

  return <div className={`markdown-content ${className}`}>{blocks}</div>;
};
