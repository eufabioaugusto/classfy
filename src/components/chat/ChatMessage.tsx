import { TypewriterText } from "./TypewriterText";
import { cn } from "@/lib/utils";
import { normalizeClassyMessageContent } from "./classyMessageContent";

interface ChatMessageProps {
  content: string;
  role: "user" | "assistant" | "system";
  isNew?: boolean;
  className?: string;
  onContentGrow?: () => void;
}

export function ChatMessage({
  content,
  role,
  isNew = false,
  className = "",
}: ChatMessageProps) {
  if (role === "user") {
    return (
      <div
        className={cn(
          "max-w-[82%] rounded-[22px] rounded-br-md bg-muted/75 px-4 py-2.5 text-foreground",
          "text-[15px] leading-6 sm:max-w-[76%]",
          className,
        )}
      >
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full max-w-none py-1 text-[15px] leading-7 text-foreground",
        isNew && "animate-in fade-in duration-200",
        className,
      )}
    >
      <TypewriterText content={normalizeClassyMessageContent(content)} />
    </div>
  );
}
