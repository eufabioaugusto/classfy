import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";

interface ContentActionsCreatorProps {
  contentId: string;
  contentTitle: string;
  onBoostClick: () => void;
  isBoosted?: boolean;
}

export const ContentActionsCreator = ({ 
  contentId, 
  contentTitle, 
  onBoostClick,
  isBoosted 
}: ContentActionsCreatorProps) => {
  return (
    <div className="flex gap-2">
      <Button
        variant={isBoosted ? "default" : "outline"}
        size="sm"
        onClick={onBoostClick}
        className="gap-2"
      >
        <Zap className="w-4 h-4" />
        {isBoosted ? 'Boost Ativo' : 'Impulsionar'}
      </Button>
    </div>
  );
};