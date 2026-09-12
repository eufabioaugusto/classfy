import { MarkdownRenderer } from "./MarkdownRenderer";

interface TypewriterTextProps {
  content: string;
  className?: string;
}

/** Renderiza a resposta completa, sem simular um streaming que já terminou. */
export function TypewriterText({
  content,
  className = "",
}: TypewriterTextProps) {
  return (
    <div className={className}>
      <MarkdownRenderer content={content} />
    </div>
  );
}
