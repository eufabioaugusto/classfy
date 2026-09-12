import { Fragment } from "react";

interface HighlightedTextProps {
  text: string;
  query: string;
  markClassName?: string;
}

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function HighlightedText({
  text,
  query,
  markClassName = "rounded bg-primary/20 px-0.5 text-foreground",
}: HighlightedTextProps) {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return <>{text}</>;
  }

  const matcher = new RegExp(`(${escapeRegex(normalizedQuery)})`, "gi");
  const queryKey = normalizedQuery.toLocaleLowerCase();

  return (
    <>
      {text.split(matcher).map((part, index) =>
        part.toLocaleLowerCase() === queryKey ? (
          <mark className={markClassName} key={`${part}-${index}`}>
            {part}
          </mark>
        ) : (
          <Fragment key={`${part}-${index}`}>{part}</Fragment>
        ),
      )}
    </>
  );
}
