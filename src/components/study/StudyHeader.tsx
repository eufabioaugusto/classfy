import { Button } from "@/components/ui/button";
import { StudyUsageIndicator } from "@/components/StudyUsageIndicator";
import { MoreVertical, Edit2, Share2, Trash2, List } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StudyHeaderProps {
  title: string;
  description?: string | null;
  messageCount: number;
  maxMessages: number;
  plan: 'free' | 'pro' | 'premium';
  savedPlaylistsCount: number;
  compact?: boolean;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
  onPlaylistsOpen?: () => void;
  playlistDropdown?: React.ReactNode;
}

export function StudyHeader({
  title,
  description,
  messageCount,
  maxMessages,
  plan,
  savedPlaylistsCount,
  compact = false,
  onRename,
  onShare,
  onDelete,
  onPlaylistsOpen,
  playlistDropdown,
}: StudyHeaderProps) {
  if (compact) {
    return (
      <header className="border-b border-border bg-card px-3 py-2.5 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate">{title}</h1>
          </div>
          <StudyUsageIndicator messageCount={messageCount} maxMessages={maxMessages} plan={plan} compact />
          <div className="flex items-center gap-1">
            {savedPlaylistsCount > 0 && (
              <Button variant="outline" size="sm" className="h-8 px-2 gap-1" onClick={onPlaylistsOpen}>
                <List className="w-4 h-4" />
                <span className="text-xs">{savedPlaylistsCount}</span>
              </Button>
            )}
            <ActionsMenu onRename={onRename} onShare={onShare} onDelete={onDelete} compact />
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="border-b border-border bg-card px-6 py-4 flex-shrink-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <StudyUsageIndicator messageCount={messageCount} maxMessages={maxMessages} plan={plan} />
        <div className="flex items-center gap-2">
          {playlistDropdown}
          <ActionsMenu onRename={onRename} onShare={onShare} onDelete={onDelete} />
        </div>
      </div>
    </header>
  );
}

function ActionsMenu({ onRename, onShare, onDelete, compact }: { onRename: () => void; onShare: () => void; onDelete: () => void; compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={compact ? "h-8 w-8" : undefined}>
          <MoreVertical className={compact ? "w-4 h-4" : "w-5 h-5"} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onRename} className="cursor-pointer">
          <Edit2 className="w-4 h-4 mr-2" /> Renomear
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onShare} className="cursor-pointer">
          <Share2 className="w-4 h-4 mr-2" /> Compartilhar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="cursor-pointer text-destructive">
          <Trash2 className="w-4 h-4 mr-2" /> Excluir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
