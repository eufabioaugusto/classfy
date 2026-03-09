import { ImageIcon, Scissors, Type, Music, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LobbyToolbarProps {
  onCoverSelect: () => void;
  onTrimToggle: () => void;
  trimActive: boolean;
}

const tools = [
  { id: "cover", label: "Capa", icon: ImageIcon, enabled: true, tooltip: "" },
  { id: "trim", label: "Cortar", icon: Scissors, enabled: true, tooltip: "" },
  { id: "text", label: "Texto", icon: Type, enabled: false, tooltip: "Recurso em desenvolvimento. Por enquanto, edite o texto do seu vídeo em ferramentas externas antes do upload." },
  { id: "music", label: "Música", icon: Music, enabled: false, tooltip: "Recurso em desenvolvimento. Adicione música ao seu vídeo em editores externos antes de fazer upload." },
  { id: "effects", label: "Efeitos", icon: Sparkles, enabled: false, tooltip: "Recurso em desenvolvimento. Use editores externos para adicionar efeitos antes do upload." },
];

export function LobbyToolbar({ onCoverSelect, onTrimToggle, trimActive }: LobbyToolbarProps) {
  const handleClick = (id: string) => {
    if (id === "cover") onCoverSelect();
    if (id === "trim") onTrimToggle();
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center justify-around px-2 py-3">
        {tools.map((tool) => {
          const isActive = tool.id === "trim" && trimActive;
          const buttonEl = (
            <button
              key={tool.id}
              type="button"
              onClick={() => tool.enabled && handleClick(tool.id)}
              disabled={!tool.enabled}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors min-w-[52px]",
                tool.enabled
                  ? isActive
                    ? "text-accent"
                    : "text-white/80 active:text-accent"
                  : "text-white/30 cursor-not-allowed"
              )}
            >
              <tool.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tool.label}</span>
              {!tool.enabled && (
                <span className="text-[8px] text-white/20">Em breve</span>
              )}
            </button>
          );

          if (!tool.enabled && tool.tooltip) {
            return (
              <Tooltip key={tool.id}>
                <TooltipTrigger asChild>
                  <span>{buttonEl}</span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px] text-center text-xs">
                  {tool.tooltip}
                </TooltipContent>
              </Tooltip>
            );
          }

          return buttonEl;
        })}
      </div>
    </TooltipProvider>
  );
}
