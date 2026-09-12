import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { normalizeClassyMessageContent } from "./classyMessageContent";

type Feedback = "helpful" | "unhelpful";

interface ClassyMessageActionsProps {
  content: string;
  onAction?: (
    action: "response_copied" | "response_feedback",
    payload: Record<string, unknown>,
  ) => void;
}

export function ClassyMessageActions({
  content,
  onAction,
}: ClassyMessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(normalizeClassyMessageContent(content));
      setCopied(true);
      onAction?.("response_copied", {});
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Não foi possível copiar a resposta.");
    }
  };

  const handleFeedback = (value: Feedback) => {
    const nextValue = feedback === value ? null : value;
    setFeedback(nextValue);
    onAction?.("response_feedback", { value: nextValue });
  };

  return (
    <div className="flex items-center gap-0.5 text-muted-foreground">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-md hover:text-foreground"
        onClick={handleCopy}
        aria-label={copied ? "Resposta copiada" : "Copiar resposta"}
        title={copied ? "Copiado" : "Copiar"}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7 rounded-md hover:text-foreground",
          feedback === "helpful" && "bg-muted text-foreground",
        )}
        onClick={() => handleFeedback("helpful")}
        aria-label="Esta resposta ajudou"
        aria-pressed={feedback === "helpful"}
        title="Resposta útil"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7 rounded-md hover:text-foreground",
          feedback === "unhelpful" && "bg-muted text-foreground",
        )}
        onClick={() => handleFeedback("unhelpful")}
        aria-label="Esta resposta não ajudou"
        aria-pressed={feedback === "unhelpful"}
        title="Resposta não útil"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
