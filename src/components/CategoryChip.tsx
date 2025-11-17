import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CategoryChipProps {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}

export const CategoryChip = ({ label, icon, active, onClick }: CategoryChipProps) => {
  return (
    <Badge
      onClick={onClick}
      className={cn(
        "px-4 py-2 cursor-pointer transition-all duration-300 text-sm font-medium",
        "hover:scale-105 hover:shadow-lg",
        active
          ? "bg-accent text-accent-foreground"
          : "bg-card/50 text-foreground hover:bg-card border border-border/50"
      )}
    >
      {icon && <span className="mr-2">{icon}</span>}
      {label}
    </Badge>
  );
};