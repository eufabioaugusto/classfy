import { useState, KeyboardEvent } from "react";
import { X, Sparkles, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TagsInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  onGenerateTags?: () => void;
  isGenerating?: boolean;
  placeholder?: string;
  className?: string;
}

export function TagsInput({
  tags,
  onChange,
  onGenerateTags,
  isGenerating = false,
  placeholder = "Digite uma tag e pressione vírgula...",
  className,
}: TagsInputProps) {
  const [inputValue, setInputValue] = useState("");

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "," || e.key === "Enter") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const addTag = () => {
    const trimmedValue = inputValue.trim().replace(/,/g, "");
    if (trimmedValue && !tags.includes(trimmedValue)) {
      onChange([...tags, trimmedValue]);
      setInputValue("");
    }
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <div className="flex flex-wrap gap-2 p-3 border border-input rounded-md bg-background min-h-[42px] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            {tags.map((tag, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="gap-1 pr-1 pl-3 py-1"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(index)}
                  className="ml-1 hover:bg-muted rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={addTag}
              placeholder={tags.length === 0 ? placeholder : ""}
              className="border-0 p-0 h-6 flex-1 min-w-[120px] focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
        </div>
        {onGenerateTags && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onGenerateTags}
            disabled={isGenerating}
            title="Gerar tags com IA"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Pressione vírgula (,) ou Enter para adicionar uma tag
      </p>
    </div>
  );
}
