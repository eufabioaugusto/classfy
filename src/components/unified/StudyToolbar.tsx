import { FileText, Brain, StickyNote, MessageSquare, Lightbulb, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToolPanel = "transcription" | "quiz" | "notes" | "comments" | "recommendations" | null;

interface StudyToolbarProps {
  activePanel: ToolPanel;
  onPanelChange: (panel: ToolPanel) => void;
  compact?: boolean;
  disabled?: boolean;
}

const tools = [
  { 
    id: "transcription" as const, 
    icon: FileText, 
    label: "Transcrição",
    description: "Leia o conteúdo completo",
    gradient: "from-blue-500/10 to-cyan-500/10",
    iconColor: "text-blue-500",
    activeGradient: "from-blue-500/20 to-cyan-500/20"
  },
  { 
    id: "quiz" as const, 
    icon: Brain, 
    label: "Quiz IA",
    description: "Teste seus conhecimentos",
    gradient: "from-purple-500/10 to-pink-500/10",
    iconColor: "text-purple-500",
    activeGradient: "from-purple-500/20 to-pink-500/20"
  },
  { 
    id: "notes" as const, 
    icon: StickyNote, 
    label: "Anotações",
    description: "Organize suas ideias",
    gradient: "from-amber-500/10 to-orange-500/10",
    iconColor: "text-amber-500",
    activeGradient: "from-amber-500/20 to-orange-500/20"
  },
  { 
    id: "comments" as const, 
    icon: MessageSquare, 
    label: "Discussão",
    description: "Converse com a comunidade",
    gradient: "from-green-500/10 to-emerald-500/10",
    iconColor: "text-green-500",
    activeGradient: "from-green-500/20 to-emerald-500/20"
  },
  { 
    id: "recommendations" as const, 
    icon: Lightbulb, 
    label: "Sugestões IA",
    description: "Conteúdos relacionados",
    gradient: "from-violet-500/10 to-indigo-500/10",
    iconColor: "text-violet-500",
    activeGradient: "from-violet-500/20 to-indigo-500/20"
  },
];

export function StudyToolbar({ activePanel, onPanelChange, compact = false, disabled = false }: StudyToolbarProps) {
  const handleToggle = (panelId: ToolPanel) => {
    if (disabled) return;
    onPanelChange(activePanel === panelId ? null : panelId);
  };

  if (compact) {
    // Mobile: Horizontal scrollable pills
    return (
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
        {tools.map((tool) => {
          const isActive = activePanel === tool.id;
          const Icon = tool.icon;

          return (
            <button
              key={tool.id}
              onClick={() => handleToggle(tool.id)}
              disabled={disabled}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl shrink-0 transition-all duration-200",
                "border backdrop-blur-sm",
                isActive 
                  ? `bg-gradient-to-br ${tool.activeGradient} border-border shadow-lg scale-105`
                  : "bg-card/50 border-border/50 hover:bg-card hover:border-border active:scale-95"
              )}
            >
              <Icon className={cn("w-4 h-4", isActive ? tool.iconColor : "text-muted-foreground")} />
              <span className={cn(
                "text-sm font-medium whitespace-nowrap",
                isActive ? "text-foreground" : "text-muted-foreground"
              )}>
                {tool.label}
              </span>
              {isActive && <Sparkles className="w-3 h-3 text-primary animate-pulse" />}
            </button>
          );
        })}
      </div>
    );
  }

  // Desktop: Grid of feature cards
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 p-1">
      {tools.map((tool) => {
        const isActive = activePanel === tool.id;
        const Icon = tool.icon;

        return (
          <button
            key={tool.id}
            onClick={() => handleToggle(tool.id)}
            disabled={disabled}
            className={cn(
              "group relative p-4 rounded-2xl transition-all duration-300",
              "border backdrop-blur-sm overflow-hidden",
              "hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]",
              isActive 
                ? `bg-gradient-to-br ${tool.activeGradient} border-border shadow-xl`
                : "bg-card/50 border-border/50 hover:bg-card hover:border-border"
            )}
          >
            {/* Glow effect on hover */}
            <div className={cn(
              "absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-300",
              tool.gradient
            )} />
            
            <div className="relative flex flex-col items-start gap-2">
              <div className={cn(
                "p-2.5 rounded-xl transition-all duration-200",
                isActive 
                  ? "bg-background/50 shadow-sm" 
                  : "bg-background/30 group-hover:bg-background/50"
              )}>
                <Icon className={cn(
                  "w-5 h-5 transition-colors",
                  isActive ? tool.iconColor : "text-muted-foreground group-hover:text-foreground"
                )} />
              </div>
              
              <div className="flex items-center gap-1.5 w-full">
                <h3 className={cn(
                  "text-sm font-semibold transition-colors",
                  isActive ? "text-foreground" : "text-foreground/90"
                )}>
                  {tool.label}
                </h3>
                {isActive && (
                  <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse flex-shrink-0" />
                )}
              </div>
              
              <p className={cn(
                "text-xs leading-relaxed transition-colors",
                isActive ? "text-muted-foreground" : "text-muted-foreground/70"
              )}>
                {tool.description}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
