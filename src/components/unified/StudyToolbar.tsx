import { FileText, Brain, StickyNote, MessageSquare, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ToolPanel = "transcription" | "quiz" | "notes" | "comments" | "recommendations" | null;

interface StudyToolbarProps {
  activePanel: ToolPanel;
  onPanelChange: (panel: ToolPanel) => void;
  compact?: boolean;
  disabled?: boolean;
}

const tools = [
  { id: "transcription" as const, icon: FileText, label: "Transcrição", shortLabel: "Trans" },
  { id: "quiz" as const, icon: Brain, label: "Quiz", shortLabel: "Quiz" },
  { id: "notes" as const, icon: StickyNote, label: "Anotações", shortLabel: "Notas" },
  { id: "comments" as const, icon: MessageSquare, label: "Comentários", shortLabel: "Coment" },
  { id: "recommendations" as const, icon: Lightbulb, label: "Recomendações", shortLabel: "Recom" },
];

export function StudyToolbar({ activePanel, onPanelChange, compact = false, disabled = false }: StudyToolbarProps) {
  const handleToggle = (panelId: ToolPanel) => {
    if (disabled) return;
    onPanelChange(activePanel === panelId ? null : panelId);
  };

  return (
    <TooltipProvider>
      <div className={cn(
        "flex items-center gap-1 bg-card/80 backdrop-blur-sm border border-border rounded-lg p-1",
        compact ? "overflow-x-auto scrollbar-hide" : ""
      )}>
        {tools.map((tool) => {
          const isActive = activePanel === tool.id;
          const Icon = tool.icon;

          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => handleToggle(tool.id)}
                  disabled={disabled}
                  className={cn(
                    "h-8 gap-1.5 shrink-0 transition-all",
                    compact ? "px-2.5" : "px-3",
                    isActive && "bg-primary/10 text-primary hover:bg-primary/20"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {!compact && (
                    <span className="text-xs hidden sm:inline">{tool.shortLabel}</span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{tool.label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
