import { ImageIcon, Scissors, Type, Music, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface LobbyToolbarProps {
  onCoverSelect: () => void;
  onTrimToggle: () => void;
  trimActive: boolean;
}

const tools = [
  { id: "cover", label: "Capa", icon: ImageIcon, enabled: true },
  { id: "trim", label: "Cortar", icon: Scissors, enabled: true },
  { id: "text", label: "Texto", icon: Type, enabled: false },
  { id: "music", label: "Música", icon: Music, enabled: false },
  { id: "effects", label: "Efeitos", icon: Sparkles, enabled: false },
];

export function LobbyToolbar({ onCoverSelect, onTrimToggle, trimActive }: LobbyToolbarProps) {
  const handleClick = (id: string) => {
    if (id === "cover") onCoverSelect();
    if (id === "trim") onTrimToggle();
  };

  return (
    <div className="flex items-center justify-around px-2 py-3">
      {tools.map((tool) => {
        const isActive = tool.id === "trim" && trimActive;
        return (
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
      })}
    </div>
  );
}
